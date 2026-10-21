import {
  Controller,
  Get,
  Injectable,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { Database } from "./database.js";
import { WorkspaceService } from "./workspace.js";
import { Clock } from "./clock.js";
import { AuthGuard, type AuthRequest } from "./auth.js";
import {
  MODEL_VERSION,
  STAR_POINTS,
  estimate,
  indicator,
  skillIndicator,
  type Estimate,
  type Observation,
} from "./insight-model.js";
import type { Prisma } from "../generated/prisma/client.js";
import * as input from "./input.js";
type Tx = Prisma.TransactionClient;
type PairDetails = {
  firstEnjoyment: Estimate;
  secondEnjoyment: Estimate;
  firstEffectiveness: Estimate;
  secondEffectiveness: Estimate;
};
const canonical = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

@Injectable()
export class InsightService {
  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly clock: Clock,
  ) {}

  // Caller holds the same company advisory lock as survey submission/generation.
  async refresh(
    tx: Tx,
    orgId: string,
    subjectIds: string[],
    pairs: [string, string][],
    now: Date,
  ) {
    const skills = await tx.skill.findMany({
      where: { orgId, active: true },
      select: { id: true },
    });
    const rows = await tx.answer.findMany({
      where: {
        orgId,
        rating: { not: null },
        assignment: {
          status: "COMPLETED",
          submittedAt: { lte: now },
          OR: [
            { subject: { membershipId: { in: subjectIds } } },
            ...pairs.flatMap(([a, b]) => [
              { respondent: { membershipId: a }, subject: { membershipId: b } },
              { respondent: { membershipId: b }, subject: { membershipId: a } },
            ]),
          ],
        },
      },
      include: {
        assignment: { include: { respondent: true, subject: true } },
        surveyQuestion: {
          include: { question: { include: { QuestionSkill_question: true } } },
        },
      },
    });
    const observations: Observation[] = [];
    for (const row of rows) {
      const a = row.assignment,
        q = row.surveyQuestion.question;
      const shared = {
        author: a.respondent.membershipId,
        subject: a.subject.membershipId,
        time: a.submittedAt!.getTime(),
        points: STAR_POINTS[row.rating! as 1 | 2 | 3 | 4 | 5],
      };
      if (q.dimension === "SKILL")
        for (const map of q.QuestionSkill_question)
          observations.push({
            ...shared,
            key: map.skillId,
            weight: Number(map.weight),
          });
      else if (
        q.dimension === "CHEMISTRY_ENJOYMENT" ||
        q.dimension === "CHEMISTRY_EFFECTIVENESS"
      )
        observations.push({ ...shared, key: q.dimension, weight: 1 });
    }
    for (const membershipId of subjectIds)
      for (const skill of skills) {
        const details = estimate(
          observations.filter(
            (o) => o.subject === membershipId && o.key === skill.id,
          ),
          now.getTime(),
        );
        const data = {
          score: details.score,
          observationCount: details.reports,
          confidence: 0,
          computedAt: now,
          details: details as unknown as Prisma.InputJsonValue,
        };
        await tx.skillInsight.upsert({
          where: {
            orgId_membershipId_skillId_modelVersion: {
              orgId,
              membershipId,
              skillId: skill.id,
              modelVersion: MODEL_VERSION,
            },
          },
          create: {
            orgId,
            membershipId,
            skillId: skill.id,
            modelVersion: MODEL_VERSION,
            ...data,
          },
          update: data,
        });
      }
    for (const pair of pairs) {
      const [firstMembershipId, secondMembershipId] = canonical(...pair);
      const get = (author: string, subject: string, key: string) =>
        estimate(
          observations.filter(
            (o) =>
              o.author === author && o.subject === subject && o.key === key,
          ),
          now.getTime(),
        );
      const details: PairDetails = {
        firstEnjoyment: get(
          firstMembershipId,
          secondMembershipId,
          "CHEMISTRY_ENJOYMENT",
        ),
        secondEnjoyment: get(
          secondMembershipId,
          firstMembershipId,
          "CHEMISTRY_ENJOYMENT",
        ),
        firstEffectiveness: get(
          firstMembershipId,
          secondMembershipId,
          "CHEMISTRY_EFFECTIVENESS",
        ),
        secondEffectiveness: get(
          secondMembershipId,
          firstMembershipId,
          "CHEMISTRY_EFFECTIVENESS",
        ),
      };
      const x = details.firstEffectiveness,
        y = details.secondEffectiveness;
      const data = {
        combinedScore: x.reports && y.reports ? (x.score + y.score) / 2 : null,
        firstToSecondScore: x.reports ? x.score : null,
        secondToFirstScore: y.reports ? y.score : null,
        observationCount: x.reports + y.reports,
        confidence: 0,
        computedAt: now,
        details: details as unknown as Prisma.InputJsonValue,
      };
      await tx.pairInsight.upsert({
        where: {
          orgId_firstMembershipId_secondMembershipId_modelVersion: {
            orgId,
            firstMembershipId,
            secondMembershipId,
            modelVersion: MODEL_VERSION,
          },
        },
        create: {
          orgId,
          firstMembershipId,
          secondMembershipId,
          modelVersion: MODEL_VERSION,
          ...data,
        },
        update: data,
      });
    }
  }

  async team(userId: string, orgId: string, teamId: string, focus?: string) {
    await this.workspace.teamScope(userId, orgId, teamId);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`;
        const viewer = await tx.membership.findFirstOrThrow({
          where: { orgId, userId, active: true },
        });
        // Re-check authorization inside the consistent snapshot; never rely on UI roles.
        const team = await this.workspaceTeam(tx, orgId, teamId);
        const current = team.TeamMember_team;
        if (focus && !current.some((m) => m.membershipId === focus))
          throw new NotFoundException();
        const own = current.some((m) => m.membershipId === viewer.id);
        const grant = team.TeamAccess_team.find(
          (a) => a.membershipId === viewer.id,
        );
        const independent = viewer.role === "HR_ADMIN";
        if (
          independent &&
          ((await tx.teamMember.count({
            where: { orgId, membershipId: viewer.id, leftAt: null },
          })) ||
            (await tx.teamAccess.count({
              where: { orgId, membershipId: viewer.id },
            })))
        )
          throw new ForbiddenException(
            "HR insight access requires independence",
          );
        const full =
          independent ||
          grant?.role === "MANAGER" ||
          (grant?.role === "TEAM_LEADER" && own);
        if (!full && !own && viewer.role !== "OWNER")
          throw new ForbiddenException();
        const mode = full ? "TEAM" : own ? "PERSONAL" : "ROSTER";
        const now = this.clock.now();
        return this.project(
          tx,
          orgId,
          viewer,
          current,
          team.TeamAccess_team,
          new Set(full ? current.map((m) => m.membershipId) : []),
          focus,
          { id: team.id, name: team.name },
          mode,
          now,
        );
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }
  async project(
    tx: Tx,
    orgId: string,
    viewer: { id: string },
    current: {
      membershipId: string;
      membership: {
        jobTitle: string | null;
        department: string | null;
        location: string | null;
        user: { displayName: string };
        photo: { updatedAt: Date } | null;
      };
    }[],
    roles: { membershipId: string; role: string }[],
    readable: Set<string>,
    focus: string | undefined,
    team: { id: string; name: string },
    mode: string,
    now: Date,
  ) {
    const allowedSubjects = current
      .filter(
        (m) => readable.has(m.membershipId) || m.membershipId === viewer.id,
      )
      .map((m) => m.membershipId);
    const pairs: [string, string][] = [];
    for (let i = 0; i < current.length; i++)
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i]!.membershipId,
          b = current[j]!.membershipId;
        if (
          focus &&
          (a === focus || b === focus) &&
          ((readable.has(a) && readable.has(b)) ||
            a === viewer.id ||
            b === viewer.id)
        )
          pairs.push(canonical(a, b));
      }
    const activeSkills = await tx.skill.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const cachedSkills = await tx.skillInsight.findMany({
      where: {
        orgId,
        membershipId: { in: allowedSubjects },
        modelVersion: MODEL_VERSION,
      },
    });
    const cachedPairs = await tx.pairInsight.findMany({
      where: {
        orgId,
        modelVersion: MODEL_VERSION,
        OR: pairs.map(([a, b]) => ({
          firstMembershipId: a,
          secondMembershipId: b,
        })),
      },
    });
    const old = (value: { computedAt: Date; details: unknown }) =>
      !value.details;
    const missingSubjects = allowedSubjects.filter((id) =>
      activeSkills.some((skill) => {
        const c = cachedSkills.find(
          (v) => v.membershipId === id && v.skillId === skill.id,
        );
        return !c || old(c);
      }),
    );
    const missingPairs = pairs.filter(([a, b]) => {
      const c = cachedPairs.find(
        (p) => p.firstMembershipId === a && p.secondMembershipId === b,
      );
      return !c || old(c);
    });
    if (missingSubjects.length || missingPairs.length)
      await this.refresh(tx, orgId, missingSubjects, missingPairs, now);
    const summaries = await tx.skillInsight.findMany({
      where: {
        orgId,
        membershipId: { in: allowedSubjects },
        modelVersion: MODEL_VERSION,
      },
    });
    const relationships = await tx.pairInsight.findMany({
      where: {
        orgId,
        modelVersion: MODEL_VERSION,
        OR: pairs.map(([a, b]) => ({
          firstMembershipId: a,
          secondMembershipId: b,
        })),
      },
    });
    const company = await tx.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { testMode: true },
    });
    return {
      testMode: company.testMode,
      team,
      mode,
      modelVersion: MODEL_VERSION,
      computedAt: now,
      employees: current.map((m) => ({
        membershipId: m.membershipId,
        displayName: m.membership.user.displayName,
        role:
          roles.find((a) => a.membershipId === m.membershipId)?.role ??
          "EMPLOYEE",
        isYou: m.membershipId === viewer.id,
        skillPresentation: readable.has(m.membershipId) ? "BANDS" : "SUMMARY",
        profile: {
          jobTitle: m.membership.jobTitle,
          department: m.membership.department,
          location: m.membership.location,
          photoUpdatedAt: m.membership.photo?.updatedAt ?? null,
        },
        skills:
          readable.has(m.membershipId) || m.membershipId === viewer.id
            ? activeSkills.map((skill) => {
                const row = summaries.find(
                  (s) =>
                    s.membershipId === m.membershipId && s.skillId === skill.id,
                );
                return {
                  id: skill.id,
                  name: skill.name,
                  indicator: skillIndicator(
                    row!.details as unknown as Estimate,
                    now.getTime(),
                  ),
                };
              })
            : null,
      })),
      relationships: relationships
        .filter((p) =>
          pairs.some(
            ([a, b]) => a === p.firstMembershipId && b === p.secondMembershipId,
          ),
        )
        .map((p) => {
          const d = p.details as unknown as PairDetails;
          const involved =
            p.firstMembershipId === viewer.id ||
            p.secondMembershipId === viewer.id;
          const unrestricted =
            readable.has(p.firstMembershipId) &&
            readable.has(p.secondMembershipId) &&
            !involved;
          const firstAllowed =
              unrestricted || p.firstMembershipId === viewer.id,
            secondAllowed = unrestricted || p.secondMembershipId === viewer.id;
          const combined =
            p.combinedScore === null
              ? null
              : {
                  score: p.combinedScore,
                  reports: Math.min(
                    d.firstEffectiveness.reports,
                    d.secondEffectiveness.reports,
                  ),
                  reviewers: 2,
                  firstAt: d.firstEffectiveness.firstAt,
                  lastAt: new Date(
                    Math.min(
                      Date.parse(d.firstEffectiveness.lastAt!),
                      Date.parse(d.secondEffectiveness.lastAt!),
                    ),
                  ).toISOString(),
                };
          return {
            firstMembershipId: p.firstMembershipId,
            secondMembershipId: p.secondMembershipId,
            visibility: unrestricted ? "BOTH_DIRECTIONS" : "OWN_EXPERIENCE",
            firstToSecond: firstAllowed
              ? {
                  enjoyment: indicator(d.firstEnjoyment, now.getTime(), true),
                  effectiveness: indicator(
                    d.firstEffectiveness,
                    now.getTime(),
                    true,
                  ),
                }
              : null,
            secondToFirst: secondAllowed
              ? {
                  enjoyment: indicator(d.secondEnjoyment, now.getTime(), true),
                  effectiveness: indicator(
                    d.secondEffectiveness,
                    now.getTime(),
                    true,
                  ),
                }
              : null,
            combined:
              unrestricted && combined
                ? indicator(combined, now.getTime(), true)
                : null,
          };
        }),
    };
  }

  async ownCard(userId: string, orgId: string) {
    const viewer = await this.workspace.member(userId, orgId);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
        const membership = await tx.membership.findFirstOrThrow({
          where: { orgId, id: viewer.id, active: true },
          include: {
            user: { select: { displayName: true } },
            photo: { select: { updatedAt: true } },
          },
        });
        const view = await this.project(
          tx,
          orgId,
          viewer,
          [{ membershipId: viewer.id, membership }],
          [],
          new Set(),
          undefined,
          { id: orgId, name: "Your company" },
          "PERSONAL",
          this.clock.now(),
        );
        const role =
          viewer.role === "EMPLOYEE"
            ? ((
                await tx.teamAccess.findFirst({
                  where: {
                    orgId,
                    membershipId: viewer.id,
                    team: {
                      OR: [
                        { endsAt: null },
                        { endsAt: { gt: this.clock.now() } },
                      ],
                    },
                  },
                  orderBy: { role: "asc" },
                  select: { role: true },
                })
              )?.role ?? "EMPLOYEE")
            : viewer.role;
        return { ...view.employees[0]!, role };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }
  private workspaceTeam(tx: Tx, orgId: string, teamId: string) {
    return tx.team.findFirstOrThrow({
      where: { id: teamId, orgId },
      include: {
        TeamMember_team: {
          where: {
            leftAt: null,
            joinedAt: { lte: this.clock.now() },
            membership: { active: true },
          },
          include: {
            membership: {
              include: {
                user: { select: { displayName: true } },
                photo: { select: { updatedAt: true } },
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        TeamAccess_team: { where: { membership: { active: true } } },
      },
    });
  }
}

@Controller("organizations/:orgId/teams/:teamId")
@UseGuards(AuthGuard)
export class InsightController {
  constructor(private readonly insights: InsightService) {}
  @Get("insights")
  team(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("teamId") team: string,
    @Query() raw: unknown,
  ) {
    const query = input.body(raw, ["focus"]);
    return this.insights.team(
      req.actor.userId,
      input.uuid(org),
      input.uuid(team),
      query.focus === undefined ? undefined : input.uuid(query.focus),
    );
  }
}

@Controller("organizations/:orgId")
@UseGuards(AuthGuard)
export class PersonalCardController {
  constructor(private readonly insights: InsightService) {}
  @Get("my-card")
  card(@Req() req: AuthRequest, @Param("orgId") org: string) {
    return this.insights.ownCard(req.actor.userId, input.uuid(org));
  }
}
