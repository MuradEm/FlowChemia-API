import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Database } from "./database.js";
import { InsightService } from "./insights.js";
import { analyzeTeam } from "./team-fit.js";
import { indicator, MODEL_VERSION } from "./insight-model.js";
import type { Estimate } from "./insight-model.js";
import { Clock } from "./clock.js";
import { AuthGuard, type AuthRequest } from "./auth.js";
import * as input from "./input.js";
import type { Prisma } from "../generated/prisma/client.js";
type Tx = Prisma.TransactionClient;
type Save = {
  requestId: string;
  teamId?: string;
  revision?: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  membershipIds: string[];
  managerIds?: string[];
  leaderIds?: string[];
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function ids(raw: unknown, max = 100): string[] {
  if (!Array.isArray(raw) || raw.length > max)
    throw new BadRequestException("Choose up to " + max + " employees");
  const result = raw.map(input.uuid);
  if (new Set(result).size !== result.length)
    throw new BadRequestException("Employees must be distinct");
  return result.sort();
}

@Injectable()
export class TeamBuilderService {
  constructor(
    private readonly db: Database,
    private readonly insights: InsightService,
    private readonly clock: Clock,
  ) {}
  private async scope(tx: Tx, userId: string, orgId: string) {
    const viewer = await tx.membership.findFirst({
      where: { orgId, userId, active: true },
    });
    if (!viewer) throw new NotFoundException("Company not found");
    const admin = viewer.role === "OWNER" || viewer.role === "HR_ADMIN";
    const now = this.clock.now();
    const managed = await tx.team.findMany({
      where: {
        orgId,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        TeamAccess_team: {
          some: { orgId, membershipId: viewer.id, role: "MANAGER" },
        },
      },
      select: { id: true },
    });
    const managedIds = managed.map((t) => t.id);
    const teams = await tx.team.findMany({
      where: {
        orgId,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        ...(admin ? {} : { id: { in: managedIds } }),
      },
      select: { id: true, name: true, startsAt: true, endsAt: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    return {
      viewer,
      admin,
      managedIds,
      teams,
      canUse: admin || managedIds.length > 0,
    };
  }
  async capabilities(userId: string, orgId: string) {
    return this.db.$transaction(async (tx) => {
      const s = await this.scope(tx, userId, orgId);
      return {
        canUse: s.canUse,
        canCreate: s.admin,
        canAssignRoles: s.admin,
        teams: s.teams,
      };
    });
  }
  private async candidates(
    tx: Tx,
    s: Awaited<ReturnType<TeamBuilderService["scope"]>>,
    orgId: string,
  ) {
    const people = await tx.membership.findMany({
      where: {
        orgId,
        active: true,
        role: { not: "HR_ADMIN" },
        ...(s.admin
          ? {}
          : {
              OR: [
                { id: s.viewer.id },
                {
                  TeamMember_membership: {
                    some: { teamId: { in: s.managedIds }, leftAt: null },
                  },
                },
              ],
            }),
      },
      include: {
        user: { select: { displayName: true } },
        photo: { select: { updatedAt: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      take: 200,
    });
    const readable = new Set<string>();
    if (s.viewer.role === "HR_ADMIN") {
      if (
        (await tx.teamAccess.count({
          where: { orgId, membershipId: s.viewer.id },
        })) ||
        (await tx.teamMember.count({
          where: { orgId, membershipId: s.viewer.id, leftAt: null },
        }))
      )
        throw new ForbiddenException("HR insight access requires independence");
      people.forEach((p) => readable.add(p.id));
    } else {
      const permitted = await tx.teamMember.findMany({
        where: {
          orgId,
          teamId: { in: s.managedIds },
          leftAt: null,
          joinedAt: { lte: this.clock.now() },
          membership: { active: true },
        },
        select: { membershipId: true },
      });
      permitted.forEach((p) => readable.add(p.membershipId));
    }
    return { people, readable };
  }
  private async draft(tx: Tx, orgId: string, id: string) {
    const team = await tx.team.findFirst({
      where: { orgId, id },
      include: {
        TeamMember_team: { where: { leftAt: null }, orderBy: { id: "asc" } },
        TeamAccess_team: { orderBy: { membershipId: "asc" } },
      },
    });
    if (!team) throw new NotFoundException("Team not found");
    const revision = hash({
      id: team.id,
      name: team.name,
      startsAt: team.startsAt,
      endsAt: team.endsAt,
      members: team.TeamMember_team.map((m) => [
        m.id,
        m.membershipId,
        m.joinedAt,
      ]),
      roles: team.TeamAccess_team.map((a) => [a.membershipId, a.role]),
    });
    return { team, revision };
  }
  async catalog(userId: string, orgId: string, teamId?: string) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
        const s = await this.scope(tx, userId, orgId);
        if (!s.canUse) throw new ForbiddenException();
        if (teamId && !s.teams.some((t) => t.id === teamId))
          throw new NotFoundException("Editable team not found");
        const { people, readable } = await this.candidates(tx, s, orgId);
        const view = await this.insights.project(
          tx,
          orgId,
          s.viewer,
          people.map((m) => ({ membershipId: m.id, membership: m })),
          [],
          readable,
          undefined,
          { id: orgId, name: "Candidate employees" },
          s.admin ? "TEAM" : "PERSONAL",
          this.clock.now(),
        );
        const saved = teamId ? await this.draft(tx, orgId, teamId) : null;
        const eligible = new Set(people.map((p) => p.id));
        return {
          canCreate: s.admin,
          canAssignRoles: s.admin,
          teams: s.teams,
          employees: view.employees,
          draft: saved
            ? {
                id: teamId!,
                revision: saved.revision,
                name: saved.team.name,
                startsAt: saved.team.startsAt,
                endsAt: saved.team.endsAt,
                membershipIds: saved.team.TeamMember_team.filter((m) =>
                  eligible.has(m.membershipId),
                ).map((m) => m.membershipId),
                managerIds: saved.team.TeamAccess_team.filter(
                  (a) => a.role === "MANAGER",
                ).map((a) => a.membershipId),
                leaderIds: saved.team.TeamAccess_team.filter(
                  (a) =>
                    a.role === "TEAM_LEADER" && eligible.has(a.membershipId),
                ).map((a) => a.membershipId),
              }
            : null,
          hasHiddenParticipants: !!saved?.team.TeamMember_team.some(
            (m) => !eligible.has(m.membershipId),
          ),
        };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }
  async preview(
    userId: string,
    orgId: string,
    selected: string[],
    focus?: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
        const s = await this.scope(tx, userId, orgId);
        if (!s.canUse) throw new ForbiddenException();
        const { people, readable } = await this.candidates(tx, s, orgId);
        if (selected.some((id) => !people.some((p) => p.id === id)))
          throw new NotFoundException("Candidate not available");
        if (focus && !selected.includes(focus))
          throw new BadRequestException("Select the employee before focusing");
        const now = this.clock.now();
        const all = await this.insights.project(
          tx,
          orgId,
          s.viewer,
          people.map((m) => ({ membershipId: m.id, membership: m })),
          [],
          readable,
          undefined,
          { id: orgId, name: "Draft team" },
          "TEAM",
          now,
        );
        const view = focus
          ? await this.insights.project(
              tx,
              orgId,
              s.viewer,
              people
                .filter((p) => selected.includes(p.id))
                .map((m) => ({ membershipId: m.id, membership: m })),
              [],
              readable,
              focus,
              { id: orgId, name: "Draft team" },
              "TEAM",
              now,
            )
          : {
              ...all,
              employees: all.employees.filter((e) =>
                selected.includes(e.membershipId),
              ),
            };
        const personIds = people.map((p) => p.id);
        // Backfill only pairs that have actual chemistry answers, not every hypothetical pairing.
        const observed = selected.length
          ? await tx.$queryRaw<{ first: string; second: string }[]>`
          SELECT DISTINCT LEAST(r."membershipId",s."membershipId") AS first, GREATEST(r."membershipId",s."membershipId") AS second
          FROM "Answer" a JOIN "Assignment" x ON x.id=a."assignmentId" AND x."orgId"=a."orgId"
          JOIN "QuestionVersion" q ON q.id=a."questionVersionId" AND q."orgId"=a."orgId"
          JOIN "TeamMember" r ON r.id=x."respondentTeamMemberId" AND r."orgId"=x."orgId"
          JOIN "TeamMember" s ON s.id=x."subjectTeamMemberId" AND s."orgId"=x."orgId"
          WHERE a."orgId"=${orgId}::uuid AND x.status='COMPLETED' AND x."submittedAt"<=${now} AND a.rating IS NOT NULL
          AND q.dimension IN ('CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS')
          AND r."membershipId"=ANY(${personIds}::uuid[]) AND s."membershipId"=ANY(${personIds}::uuid[])
          AND (r."membershipId"=ANY(${selected}::uuid[]) OR s."membershipId"=ANY(${selected}::uuid[]))
        `
          : [];
        const query = {
          orgId,
          modelVersion: MODEL_VERSION,
          firstMembershipId: { in: personIds },
          secondMembershipId: { in: personIds },
          OR: [
            { firstMembershipId: { in: selected } },
            { secondMembershipId: { in: selected } },
          ],
        };
        let rows = await tx.pairInsight.findMany({ where: query });
        const missing = observed.filter(
          (p) =>
            readable.has(p.first) &&
            readable.has(p.second) &&
            p.first !== s.viewer.id &&
            p.second !== s.viewer.id &&
            !rows.some(
              (r) =>
                r.firstMembershipId === p.first &&
                r.secondMembershipId === p.second &&
                r.details,
            ),
        );
        if (missing.length) {
          await this.insights.refresh(
            tx,
            orgId,
            [],
            missing.map((p) => [p.first, p.second]),
            now,
          );
          rows = await tx.pairInsight.findMany({ where: query });
        }
        const pairs = rows.map((row) => {
          const d = row.details as unknown as {
            firstEffectiveness: Estimate;
            secondEffectiveness: Estimate;
          } | null;
          const a = d?.firstEffectiveness,
            b = d?.secondEffectiveness;
          const points = a && b ? (a.score + b.score) / 2 : 0;
          const value =
            a && b
              ? indicator(
                  {
                    score: points,
                    reports: Math.min(a.reports, b.reports),
                    reviewers: 2,
                    firstAt: null,
                    lastAt:
                      a.lastAt && b.lastAt
                        ? new Date(
                            Math.min(
                              Date.parse(a.lastAt),
                              Date.parse(b.lastAt),
                            ),
                          ).toISOString()
                        : null,
                  },
                  now.getTime(),
                  true,
                )
              : null;
          return {
            first: row.firstMembershipId,
            second: row.secondMembershipId,
            points,
            observed: !!a?.reports && !!b?.reports,
            established:
              !!value &&
              ["POSITIVE", "MIXED", "DIFFICULT"].includes(value.state),
          };
        });
        const bands = ["RED", "ORANGE", "YELLOW", "LIGHT_GREEN", "GREEN"];
        return {
          ...view,
          ...analyzeTeam(
            all.employees.map((p) => ({
              id: p.membershipId,
              name: p.displayName,
              limitedSkills: (p.skills ?? []).some((skill) =>
                ["EARLY", "OLDER"].includes(skill.indicator.state),
              ),
              bands: (p.skills ?? []).flatMap((skill) =>
                skill.indicator.band
                  ? [bands.indexOf(skill.indicator.band) + 1]
                  : [],
              ),
            })),
            selected,
            pairs,
            readable,
            s.viewer.id,
          ),
        };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }
  async save(userId: string, orgId: string, body: Save) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
        const s = await this.scope(tx, userId, orgId);
        if (!s.canUse) throw new ForbiddenException();
        if (body.teamId ? !s.teams.some((t) => t.id === body.teamId) : !s.admin)
          throw new ForbiddenException();
        if (
          !s.admin &&
          (body.managerIds !== undefined || body.leaderIds !== undefined)
        )
          throw new ForbiddenException(
            "Only HR and owners assign responsibilities",
          );
        const payloadHash = hash(body);
        const prior = await tx.teamBuildRequest.findUnique({
          where: { orgId_requestId: { orgId, requestId: body.requestId } },
        });
        if (prior) {
          if (
            prior.actorId !== s.viewer.id ||
            prior.payloadHash !== payloadHash
          )
            throw new ConflictException("This save request was already used");
          return { teamId: prior.teamId, alreadySaved: true };
        }
        const startsAt = new Date(body.startsAt),
          endsAt = body.endsAt ? new Date(body.endsAt) : null;
        if (endsAt && (endsAt <= startsAt || endsAt <= this.clock.now()))
          throw new BadRequestException(
            "The end must be in the future and after the start",
          );
        const { people } = await this.candidates(tx, s, orgId),
          eligible = new Set(people.map((p) => p.id));
        if (body.membershipIds.some((id) => !eligible.has(id)))
          throw new NotFoundException("Candidate not available");
        const saved = body.teamId
          ? await this.draft(tx, orgId, body.teamId)
          : null;
        if (saved && saved.revision !== body.revision)
          throw new ConflictException("Team has changed. Reload before saving");
        if (
          saved?.team.TeamMember_team.some((m) => !eligible.has(m.membershipId))
        )
          throw new ConflictException(
            "Some existing participants are unavailable. Resolve the roster in Company setup",
          );
        const managerIds =
          body.managerIds ??
          saved?.team.TeamAccess_team.filter((a) => a.role === "MANAGER").map(
            (a) => a.membershipId,
          ) ??
          [];
        const leaderIds =
          body.leaderIds ??
          saved?.team.TeamAccess_team.filter(
            (a) =>
              a.role === "TEAM_LEADER" &&
              body.membershipIds.includes(a.membershipId),
          ).map((a) => a.membershipId) ??
          [];
        if (
          s.admin &&
          [...managerIds, ...leaderIds].some((id) => !eligible.has(id))
        )
          throw new NotFoundException("Responsibility candidate unavailable");
        if (leaderIds.some((id) => !body.membershipIds.includes(id)))
          throw new BadRequestException("Team leaders must participate");
        if (leaderIds.some((id) => managerIds.includes(id)))
          throw new BadRequestException(
            "Choose one responsibility per employee",
          );
        const team = saved
          ? await tx.team.update({
              where: { id: saved.team.id },
              data: { name: body.name, startsAt, endsAt },
            })
          : await tx.team.create({
              data: { orgId, name: body.name, startsAt, endsAt },
            });
        const current = saved?.team.TeamMember_team ?? [];
        const removed = current.filter(
          (m) => !body.membershipIds.includes(m.membershipId),
        );
        if (removed.length) {
          await tx.teamMember.updateMany({
            where: { id: { in: removed.map((m) => m.id) }, orgId },
            data: { leftAt: this.clock.now() },
          });
          await tx.teamAccess.deleteMany({
            where: {
              orgId,
              teamId: team.id,
              role: "TEAM_LEADER",
              membershipId: { in: removed.map((m) => m.membershipId) },
            },
          });
        }
        const added = body.membershipIds.filter(
          (id) => !current.some((m) => m.membershipId === id),
        );
        if (added.length)
          await tx.teamMember.createMany({
            data: added.map((membershipId) => ({
              orgId,
              teamId: team.id,
              membershipId,
              joinedAt: this.clock.now(),
            })),
          });
        if (s.admin) {
          const roles = [
            ...managerIds.map((membershipId) => ({
              membershipId,
              role: "MANAGER" as const,
            })),
            ...leaderIds.map((membershipId) => ({
              membershipId,
              role: "TEAM_LEADER" as const,
            })),
          ];
          await tx.teamAccess.deleteMany({
            where: {
              orgId,
              teamId: team.id,
              membershipId: { notIn: roles.map((r) => r.membershipId) },
            },
          });
          for (const r of roles)
            await tx.teamAccess.upsert({
              where: {
                orgId_teamId_membershipId: {
                  orgId,
                  teamId: team.id,
                  membershipId: r.membershipId,
                },
              },
              create: { orgId, teamId: team.id, ...r },
              update: { role: r.role },
            });
        }
        await tx.teamBuildRequest.create({
          data: {
            orgId,
            requestId: body.requestId,
            teamId: team.id,
            actorId: s.viewer.id,
            payloadHash,
          },
        });
        return { teamId: team.id, alreadySaved: false };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }
}

@Controller("organizations/:orgId/team-builder")
@UseGuards(AuthGuard)
export class TeamBuilderController {
  constructor(private readonly builder: TeamBuilderService) {}
  @Get("capabilities") capabilities(
    @Req() r: AuthRequest,
    @Param("orgId") org: string,
  ) {
    return this.builder.capabilities(r.actor.userId, input.uuid(org));
  }
  @Get() catalog(
    @Req() r: AuthRequest,
    @Param("orgId") org: string,
    @Query() raw: unknown,
  ) {
    const q = input.body(raw, ["teamId"]);
    return this.builder.catalog(
      r.actor.userId,
      input.uuid(org),
      q.teamId === undefined ? undefined : input.uuid(q.teamId),
    );
  }
  @Post("preview") @HttpCode(200) preview(
    @Req() r: AuthRequest,
    @Param("orgId") org: string,
    @Body() raw: unknown,
  ) {
    const b = input.body(raw, ["membershipIds", "focus"]);
    return this.builder.preview(
      r.actor.userId,
      input.uuid(org),
      ids(b.membershipIds, 100),
      b.focus === undefined ? undefined : input.uuid(b.focus),
    );
  }
  @Post("save") @HttpCode(200) save(
    @Req() r: AuthRequest,
    @Param("orgId") org: string,
    @Body() raw: unknown,
  ) {
    const b = input.body(raw, [
      "requestId",
      "teamId",
      "revision",
      "name",
      "startsAt",
      "endsAt",
      "membershipIds",
      "managerIds",
      "leaderIds",
    ]);
    const body: Save = {
      requestId: input.uuid(b.requestId),
      ...(b.teamId === undefined
        ? {}
        : {
            teamId: input.uuid(b.teamId),
            revision: input.text(b.revision, "revision", 64),
          }),
      name: input.text(b.name, "team name"),
      startsAt: input.date(b.startsAt).toISOString(),
      endsAt: b.endsAt === null ? null : input.date(b.endsAt).toISOString(),
      membershipIds: ids(b.membershipIds),
      ...(b.managerIds === undefined ? {} : { managerIds: ids(b.managerIds) }),
      ...(b.leaderIds === undefined ? {} : { leaderIds: ids(b.leaderIds) }),
    };
    return this.builder.save(r.actor.userId, input.uuid(org), body);
  }
}
