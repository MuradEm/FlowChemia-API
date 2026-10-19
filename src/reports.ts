import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Database } from './database.js';
import { WorkspaceService } from './workspace.js';
import { AuthGuard, type AuthRequest } from './auth.js';
import * as input from './input.js';

type ReportKind = 'ALL' | 'PERIODIC' | 'MILESTONE';
type Counts = {
  issuedSlots: number;
  completed: number;
  skipped: number;
  insufficientOpportunity: number;
  pending: number;
  scheduled: number;
  expired: number;
  unavailable: number;
};
type TeamCounts = Counts & {teamId: string; teamName: string};
type Window = {from: Date; to: Date; kind: ReportKind};

const empty = (): Counts => ({issuedSlots: 0, completed: 0, skipped: 0, insufficientOpportunity: 0, pending: 0, scheduled: 0, expired: 0, unavailable: 0});
const rate = (c: Counts) => c.issuedSlots ? Math.round(c.completed / c.issuedSlots * 10000) / 10000 : null;

function filters(raw: unknown, now: Date): Window {
  const query = input.body(raw, ['from', 'to', 'kind']);
  if ((query.from === undefined) !== (query.to === undefined)) throw new BadRequestException('Supply both from and to');
  const from = query.from === undefined ? new Date(now.getTime() - 30 * 86400000) : input.date(query.from);
  const to = query.to === undefined ? now : input.date(query.to);
  if (to <= from || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Report window must be positive and at most 366 days');
  const kind = query.kind ?? 'ALL';
  if (kind !== 'ALL' && kind !== 'PERIODIC' && kind !== 'MILESTONE') throw new BadRequestException('Invalid report kind');
  return {from, to, kind};
}

@Injectable()
export class ReportService {
  constructor(private readonly db: Database, private readonly workspace: WorkspaceService) {}

  async completion(userId: string, orgId: string, teamId: string | null, raw: unknown) {
    const asOf = new Date();
    const window = filters(raw, asOf);
    let team: {id: string; name: string} | undefined;
    if (!teamId) {
      await this.workspace.admin(userId, orgId);
    } else {
      const member = await this.workspace.member(userId, orgId);
      team = await this.workspace.teamScope(userId, orgId, teamId);
      if (!['OWNER', 'HR_ADMIN'].includes(member.role)) {
        const access = await this.db.teamAccess.findUnique({where: {orgId_teamId_membershipId: {orgId, teamId, membershipId: member.id}}});
        if (!access) throw new ForbiddenException();
        // teamScope already requires a current participant for team-leader access.
      }
    }

    // One statement sees one MVCC snapshot. Replacements stay attributed to the
    // original team's slot, even if their evidence is collected in another team.
    // Never join Answer or ParticipationCredit and never return pair identities.
    const rows = await this.db.$queryRaw<TeamCounts[]>`
      WITH RECURSIVE history AS (
        SELECT a.id AS "rootId", a."teamId" AS "cohortTeamId", a.id,
               a.status, a."surveyId", a."respondentTeamMemberId", a."subjectTeamMemberId"
        FROM "Assignment" a JOIN "Survey" s ON s.id = a."surveyId" AND s."orgId" = a."orgId"
        WHERE a."orgId" = ${orgId}::uuid AND a."replacesAssignmentId" IS NULL
          AND a."createdAt" >= ${window.from}::timestamp AND a."createdAt" < ${window.to}::timestamp
          AND (${teamId}::uuid IS NULL OR a."teamId" = ${teamId}::uuid)
          AND (${window.kind}::text = 'ALL' OR s.kind::text = ${window.kind}::text
               OR (${window.kind}::text = 'PERIODIC' AND s.kind::text = 'WEEKLY'))
        UNION ALL
        SELECT h."rootId", h."cohortTeamId", child.id, child.status, child."surveyId",
               child."respondentTeamMemberId", child."subjectTeamMemberId"
        FROM history h JOIN "Assignment" child ON child."replacesAssignmentId" = h.id AND child."orgId" = ${orgId}::uuid
      ), leaves AS (
        SELECT h.*, CASE
          WHEN h.status = 'COMPLETED' THEN 'completed'
          WHEN h.status = 'SKIPPED' THEN 'skipped'
          WHEN h.status = 'NO_REPLACEMENT' THEN 'insufficientOpportunity'
          WHEN s."closesAt" <= ${asOf}::timestamp THEN 'expired'
          WHEN NOT rm.active OR NOT sm.active THEN 'unavailable'
          WHEN s."opensAt" > ${asOf}::timestamp THEN 'scheduled'
          ELSE 'pending' END AS bucket
        FROM history h
        JOIN "Survey" s ON s.id = h."surveyId" AND s."orgId" = ${orgId}::uuid
        JOIN "Team" t ON t.id = s."teamId" AND t."orgId" = ${orgId}::uuid
        JOIN "TeamMember" r ON r.id = h."respondentTeamMemberId" AND r."orgId" = ${orgId}::uuid
        JOIN "TeamMember" p ON p.id = h."subjectTeamMemberId" AND p."orgId" = ${orgId}::uuid
        JOIN "Membership" rm ON rm.id = r."membershipId" AND rm."orgId" = ${orgId}::uuid
        JOIN "Membership" sm ON sm.id = p."membershipId" AND sm."orgId" = ${orgId}::uuid
        WHERE NOT EXISTS (SELECT 1 FROM "Assignment" child WHERE child."replacesAssignmentId" = h.id AND child."orgId" = ${orgId}::uuid)
      )
      SELECT t.id AS "teamId", t.name AS "teamName", count(*)::int AS "issuedSlots",
        count(*) FILTER (WHERE bucket = 'completed')::int AS completed,
        count(*) FILTER (WHERE bucket = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE bucket = 'insufficientOpportunity')::int AS "insufficientOpportunity",
        count(*) FILTER (WHERE bucket = 'pending')::int AS pending,
        count(*) FILTER (WHERE bucket = 'scheduled')::int AS scheduled,
        count(*) FILTER (WHERE bucket = 'expired')::int AS expired,
        count(*) FILTER (WHERE bucket = 'unavailable')::int AS unavailable
      FROM leaves l JOIN "Team" t ON t.id = l."cohortTeamId" AND t."orgId" = ${orgId}::uuid
      GROUP BY t.id, t.name ORDER BY t.name, t.id
    `;
    const totals = empty();
    for (const row of rows) for (const key of Object.keys(totals) as (keyof Counts)[]) totals[key] += row[key];
    const teams = rows.map(row => ({...row, completionRate: rate(row)}));
    if (team && !teams.length) teams.push({teamId: team.id, teamName: team.name, ...empty(), completionRate: null});
    return {from: window.from, to: window.to, asOf, kind: window.kind, totals: {...totals, completionRate: rate(totals)}, teams};
  }
}

@Controller('organizations/:orgId')
@UseGuards(AuthGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('reports/completion')
  company(@Req() req: AuthRequest, @Param('orgId') org: string, @Query() query: unknown) {
    return this.reports.completion(req.actor.userId, input.uuid(org), null, query);
  }

  @Get('teams/:teamId/reports/completion')
  team(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('teamId') team: string, @Query() query: unknown) {
    return this.reports.completion(req.actor.userId, input.uuid(org), input.uuid(team), query);
  }
}
