import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { InsightService } from './insights.js';
import { Database } from './database.js';
import { WorkspaceService } from './workspace.js';
import { Clock } from './clock.js';
import { SURVEY_FORMAT } from './survey-format.js';
import { anchorFor, calendarWindow, firstBoundary, type Frequency } from './calendar.js';
import type { Prisma } from '../generated/prisma/client.js';
import { selectQuestions, type SelectionQuestion, type SelectionEvidence } from './question-selection.js';

type Tx = Prisma.TransactionClient;
export type ScheduleInput = {
  questionSelection?: 'MANUAL' | 'ADAPTIVE';
  frequency?: Frequency;
  colleaguesPerPeriod?: number;
  timeZone?: string;
  weekday?: number;
  monthDay?: number;
  generationTime?: string;
  automaticEnabled?: boolean;
  questionVersionIds?: string[];
};

export type RatingAnswer = {questionVersionId: string; rating: number | null};

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

@Injectable()
export class SurveyService {
  constructor(private readonly db: Database, private readonly workspace: WorkspaceService, private readonly clock: Clock, private readonly insights: InsightService) {}

  // Serialize generation per company. Queries remain tenant-scoped inside the lock.
  private async lock(tx: Tx, orgId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`;
  }

  private async policy(tx: Tx, orgId: string, now: Date) {
    let policy = await tx.feedbackPolicy.findFirst({where: {orgId, effectiveFrom: {lte: now}}, orderBy: {effectiveFrom: 'desc'}});
    if (!policy) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      policy = await tx.feedbackPolicy.create({data: {orgId, effectiveFrom: start}});
    }
    const settings = {...policy, anchorDate: policy.anchorDate ?? anchorFor(policy, policy.effectiveFrom)};
    return {policy, ...calendarWindow(settings, now)};
  }

  async schedule(userId: string, orgId: string) {
    await this.workspace.member(userId, orgId);
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const now = this.clock.now();
      const current = await this.policy(tx, orgId, now);
      const pending = await tx.feedbackPolicy.findFirst({where: {orgId, effectiveFrom: {gt: now}}, orderBy: {effectiveFrom: 'asc'}});
      const lastGeneration = await tx.surveyGeneration.findFirst({where: {orgId}, orderBy: {scheduledFor: 'desc'}});
      let nextGenerationAt: Date | null = current.policy.automaticEnabled ?
        (current.policy.automaticStartsAt && current.policy.automaticStartsAt > now ? current.policy.automaticStartsAt :
          lastGeneration && lastGeneration.scheduledFor >= current.opensAt ? current.closesAt : current.opensAt) : null;
      if (pending && (!nextGenerationAt || pending.effectiveFrom <= nextGenerationAt)) nextGenerationAt = pending.automaticEnabled ? pending.automaticStartsAt : null;
      return {...current, pending, nextGenerationAt, lastGeneration, surveyFormat: SURVEY_FORMAT, requiresQuestionSetUpdate: current.policy.questionSelection === 'MANUAL' && current.policy.questionVersionIds.length > 0 && current.policy.questionVersionIds.length !== SURVEY_FORMAT.questionCount};
    });
  }

  async setSchedule(userId: string, orgId: string, change: ScheduleInput) {
    await this.workspace.admin(userId, orgId);
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const now = this.clock.now();
      const current = await this.policy(tx, orgId, now);
      const frequency = change.frequency ?? current.policy.frequency;
      const settings = {
        questionSelection: change.questionSelection ?? current.policy.questionSelection,
        frequency,
        colleaguesPerPeriod: change.colleaguesPerPeriod ?? current.policy.colleaguesPerPeriod,
        timeZone: change.timeZone ?? current.policy.timeZone,
        weekday: change.weekday ?? current.policy.weekday,
        monthDay: change.monthDay ?? current.policy.monthDay,
        generationHour: change.generationTime ? Number(change.generationTime.slice(0, 2)) : current.policy.generationHour,
        generationMinute: change.generationTime ? Number(change.generationTime.slice(3)) : current.policy.generationMinute,
        automaticEnabled: change.automaticEnabled ?? current.policy.automaticEnabled,
        questionVersionIds: change.questionVersionIds ?? current.policy.questionVersionIds,
        anchorDate: current.policy.anchorDate,
        // Retained for older API clients; calendar math uses frequency, not this field.
        periodDays: frequency === 'WEEKLY' ? 7 : frequency === 'FORTNIGHTLY' ? 14 : 30,
      };
      const calendarChanged = frequency !== current.policy.frequency || settings.timeZone !== current.policy.timeZone || settings.weekday !== current.policy.weekday || settings.generationHour !== current.policy.generationHour || settings.generationMinute !== current.policy.generationMinute;
      if (settings.questionSelection === 'ADAPTIVE') {
        if (change.questionVersionIds?.length) throw new BadRequestException('Adaptive selection uses the approved company library');
        settings.questionVersionIds = [];
        if (settings.automaticEnabled || change.questionSelection === 'ADAPTIVE') await this.adaptivePool(tx, orgId);
      } else {
        if (settings.questionVersionIds.length && (settings.automaticEnabled || change.questionVersionIds !== undefined)) await this.checkQuestions(tx, orgId, settings.questionVersionIds);
        if (settings.automaticEnabled && !settings.questionVersionIds.length) throw new BadRequestException('Select a question set before enabling automatic surveys');
      }
      const hasSurveys = await tx.survey.count({where: {orgId, kind: 'PERIODIC', opensAt: current.opensAt}});
      const pause = change.automaticEnabled === false;
      const effectiveFrom = hasSurveys && !pause ? current.closesAt : now;
      if (calendarChanged) {
        const anchorInstant = frequency === 'FORTNIGHTLY' ? firstBoundary({...settings, frequency: 'WEEKLY', anchorDate: null}, effectiveFrom) : effectiveFrom;
        settings.anchorDate = anchorFor(settings, anchorInstant);
      } else settings.anchorDate = current.policy.anchorDate ?? anchorFor(current.policy, current.policy.effectiveFrom);
      const automaticStartsAt = settings.automaticEnabled ?
        (effectiveFrom > now ? firstBoundary(settings, effectiveFrom) : calendarWindow(settings, now).closesAt) : null;
      await tx.feedbackPolicy.deleteMany({where: {orgId, effectiveFrom: {gt: now}}});
      return tx.feedbackPolicy.upsert({where: {orgId_effectiveFrom: {orgId, effectiveFrom}}, create: {orgId, effectiveFrom, ...settings, automaticStartsAt}, update: {...settings, automaticStartsAt}});
    });
  }

  async skills(userId: string, orgId: string) {
    await this.workspace.member(userId, orgId);
    return this.db.skill.findMany({where: {orgId}, select: {id: true, name: true, active: true}, orderBy: {name: 'asc'}});
  }

  async createSkill(userId: string, orgId: string, name: string) {
    await this.workspace.admin(userId, orgId);
    return this.db.skill.create({data: {orgId, name}, select: {id: true, name: true, active: true}});
  }

  private async checkQuestions(tx: Tx, orgId: string, ids: string[]) {
    if (ids.length !== SURVEY_FORMAT.questionCount) throw new BadRequestException('Select exactly five rating questions');
    const questions = await tx.questionVersion.findMany({where: {orgId, id: {in: ids}, active: true, kind: 'RATING', approvalStatus: 'APPROVED'}, select: {dimension: true}});
    if (questions.length !== ids.length) throw new BadRequestException('Questions must be approved, active and belong to this company');
    const enjoyment = questions.filter(q => q.dimension === 'CHEMISTRY_ENJOYMENT').length;
    const effectiveness = questions.filter(q => q.dimension === 'CHEMISTRY_EFFECTIVENESS').length;
    const skills = questions.filter(q => q.dimension === 'SKILL').length;
    if (!((skills === 3 && enjoyment === 1 && effectiveness === 1) || (skills === 4 && enjoyment + effectiveness === 1))) throw new BadRequestException('Choose three skill questions plus one enjoyment and one effectiveness question, or four skill questions plus one chemistry question');
  }

  private async adaptivePool(tx: Tx, orgId: string, ids?: string[]): Promise<SelectionQuestion[]> {
    const rows = await tx.questionVersion.findMany({where: {orgId, ...(ids ? {id:{in:ids}} : {}), active:true, kind:'RATING', approvalStatus:'APPROVED', dimension:{not:'UNSPECIFIED'}}, include:{QuestionSkill_question:{include:{skill:true}}}, orderBy:[{questionKey:'asc'},{version:'desc'}]});
    const pool: SelectionQuestion[] = [];
    for (const q of rows) {
      if (pool.some(p=>p.questionKey===q.questionKey)) continue;
      if (q.dimension==='SKILL' && (!q.QuestionSkill_question.length || q.QuestionSkill_question.some(w=>!w.skill.active))) continue;
      pool.push({id:q.id,questionKey:q.questionKey,dimension:q.dimension,weights:q.QuestionSkill_question.map(w=>({skillId:w.skillId,weight:Number(w.weight)}))});
    }
    if(pool.filter(q=>q.dimension==='SKILL').length<3 || !pool.some(q=>q.dimension==='CHEMISTRY_ENJOYMENT') || !pool.some(q=>q.dimension==='CHEMISTRY_EFFECTIVENESS')) throw new BadRequestException('Adaptive selection needs at least three approved active skill questions and both chemistry dimensions');
    return pool;
  }

  private async selectionContext(tx: Tx, orgId: string, now: Date) {
    const answers = await tx.answer.findMany({where:{orgId,rating:{not:null},assignment:{status:'COMPLETED',submittedAt:{lte:now}}},include:{assignment:{include:{respondent:true,subject:true}},surveyQuestion:{include:{question:{include:{QuestionSkill_question:true}}}}}});
    const evidence: SelectionEvidence[] = answers.map(a=>({author:a.assignment.respondent.membershipId,subject:a.assignment.subject.membershipId,time:a.assignment.submittedAt!.getTime(),question:{id:a.questionVersionId,questionKey:a.surveyQuestion.question.questionKey,dimension:a.surveyQuestion.question.dimension,weights:a.surveyQuestion.question.QuestionSkill_question.map(w=>({skillId:w.skillId,weight:Number(w.weight)}))}}));
    const open = await tx.assignment.findMany({where:{orgId,status:'OPEN',respondent:{membership:{active:true}},subject:{membership:{active:true}},survey:{opensAt:{lte:now},OR:[{closesAt:null},{closesAt:{gt:now}}]}},include:{respondent:true,subject:true,survey:{include:{SurveyQuestion_survey:{include:{question:{include:{QuestionSkill_question:true}}}}}}}});
    const pending: SelectionEvidence[] = open.flatMap(a=>a.survey.SurveyQuestion_survey.filter(q=>!a.questionVersionIds.length||a.questionVersionIds.includes(q.questionVersionId)).map(q=>({author:a.respondent.membershipId,subject:a.subject.membershipId,time:a.createdAt.getTime(),question:{id:q.questionVersionId,questionKey:q.question.questionKey,dimension:q.question.dimension,weights:q.question.QuestionSkill_question.map(w=>({skillId:w.skillId,weight:Number(w.weight)}))}})));
    return {evidence,pending};
  }

  private assignedQuestions(a: Awaited<ReturnType<SurveyService['ownAssignment']>>) {
    return a.questionVersionIds.length ? a.questionVersionIds.map(id=>a.survey.SurveyQuestion_survey.find(q=>q.questionVersionId===id)!) : a.survey.SurveyQuestion_survey;
  }

  async periodic(userId: string, orgId: string, questionIds?: string[]) {
    await this.workspace.admin(userId, orgId);
    return this.generate(orgId, questionIds, false);
  }

  async generateAutomatic(orgId: string) {
    return this.generate(orgId, undefined, true);
  }

  private async generate(orgId: string, selectedQuestions: string[] | undefined, automatic: boolean) {
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const now = this.clock.now();
      const {policy, opensAt, closesAt} = await this.policy(tx, orgId, now);
      if (automatic && (!policy.automaticEnabled || !policy.automaticStartsAt || now < policy.automaticStartsAt || opensAt < policy.automaticStartsAt)) return null;
      const adaptive = policy.questionSelection === 'ADAPTIVE';
      if (adaptive && selectedQuestions) throw new BadRequestException('Omit questionVersionIds for adaptive selection');
      const receiptIds = adaptive ? [] : selectedQuestions ?? policy.questionVersionIds;
      if (!adaptive && !receiptIds.length) throw new BadRequestException('Select five questions');
      if (policy.automaticEnabled && selectedQuestions && JSON.stringify(selectedQuestions) !== JSON.stringify(policy.questionVersionIds)) throw new ConflictException('Use the configured automatic question set');
      if (!adaptive) await this.checkQuestions(tx, orgId, receiptIds);
      const previous = await tx.surveyGeneration.findUnique({where: {orgId_scheduledFor: {orgId, scheduledFor: opensAt}}});
      if (previous) {
        if (previous.questionSelection !== policy.questionSelection || JSON.stringify(previous.questionVersionIds) !== JSON.stringify(receiptIds)) throw new ConflictException('This period already uses a different question set');
        return {generationId: previous.id, periodStart: opensAt, periodEnd: closesAt, createdSurveys: 0, createdAssignments: 0, blockedEmployees: 0, employeesWithLimitedPeers: 0, alreadyProcessed: true};
      }
      const pool = adaptive ? await this.adaptivePool(tx, orgId) : [];
      const questionIds = adaptive ? pool.map(q=>q.id) : receiptIds;
      const context = adaptive ? await this.selectionContext(tx, orgId, now) : null;
      const generation = await tx.surveyGeneration.create({data: {orgId, policyId: policy.id, scheduledFor: opensAt, createdAt: now, questionSelection: policy.questionSelection, questionVersionIds: receiptIds}});
      const teams = await tx.team.findMany({where: {orgId, startsAt: {lte: now}, OR: [{endsAt: null}, {endsAt: {gt: now}}]}, include: {TeamMember_team: {where: {joinedAt: {lte: now}, leftAt: null, membership: {active: true, role: {not: 'HR_ADMIN'}}}}}, orderBy: {id: 'asc'}});
      type Candidate = {teamId: string; respondentId: string; subjectId: string; subjectMembershipId: string};
      const candidates = new Map<string, Map<string, Candidate>>();
      for (const team of teams) for (const respondent of team.TeamMember_team) {
        let peers = candidates.get(respondent.membershipId);
        if (!peers) { peers = new Map(); candidates.set(respondent.membershipId, peers); }
        for (const subject of team.TeamMember_team) if (respondent.membershipId !== subject.membershipId && !peers.has(subject.membershipId)) {
          peers.set(subject.membershipId, {teamId: team.id, respondentId: respondent.id, subjectId: subject.id, subjectMembershipId: subject.membershipId});
        }
      }
      // A worker arriving late must still skip people who were outstanding at
      // the scheduled boundary, even if they completed before this retry.
      const outstanding = await tx.assignment.findMany({where: {orgId, respondent: {membershipId: {in: [...candidates.keys()]}}, OR: [
        {status: 'OPEN', survey: {OR: [{closesAt: null}, {closesAt: {gt: now}}]}},
        {closedAt: {gt: opensAt}, survey: {OR: [{closesAt: null}, {closesAt: {gt: opensAt}}]}},
      ]}, select: {respondent: {select: {membershipId: true}}}});
      const blocked = new Set(outstanding.map(a => a.respondent.membershipId));
      const existingSurveys = await tx.survey.findMany({where: {orgId, kind: 'PERIODIC', opensAt}, include: {SurveyQuestion_survey: {orderBy: {position: 'asc'}}}});
      for (const s of existingSurveys) if (s.questionSelection !== policy.questionSelection || JSON.stringify(s.SurveyQuestion_survey.map(q => q.questionVersionId)) !== JSON.stringify(questionIds)) throw new ConflictException('This period already uses a different question set');
      const surveys = new Map(existingSurveys.map(s => [s.teamId, s.id]));
      let createdAssignments = 0;
      let createdSurveys = 0;
      let employeesWithLimitedPeers = 0;
      for (const [membershipId, peers] of candidates) {
        if (blocked.has(membershipId)) continue;
        if (peers.size < policy.colleaguesPerPeriod) employeesWithLimitedPeers++;
        const selected = shuffled([...peers.values()]).slice(0, policy.colleaguesPerPeriod);
        for (const peer of selected) {
          let surveyId = surveys.get(peer.teamId);
          if (!surveyId) {
            const survey = await tx.survey.create({data: {orgId, teamId: peer.teamId, kind: 'PERIODIC', opensAt, closesAt: null, generationId: generation.id, questionSelection: policy.questionSelection}});
            await tx.surveyQuestion.createMany({data: questionIds.map((id, i) => ({orgId, surveyId: survey.id, questionVersionId: id, position: i + 1}))});
            surveyId = survey.id; surveys.set(peer.teamId, surveyId); createdSurveys++;
          }
          const assignedIds = context ? selectQuestions(pool, context.evidence, context.pending, membershipId, peer.subjectMembershipId, now.getTime()) : [];
          await tx.assignment.create({data: {orgId, teamId: peer.teamId, surveyId, respondentTeamMemberId: peer.respondentId, subjectTeamMemberId: peer.subjectId, createdAt: now, questionVersionIds: assignedIds}});
          if (context) context.pending.push(...assignedIds.map(id=>({author:membershipId,subject:peer.subjectMembershipId,time:now.getTime(),question:pool.find(q=>q.id===id)!})));
          createdAssignments++;
        }
      }
      await tx.surveyGeneration.update({where: {id: generation.id}, data: {createdAssignments, blockedEmployees: blocked.size, employeesWithLimitedPeers}});
      return {generationId: generation.id, periodStart: opensAt, periodEnd: closesAt, createdSurveys, createdAssignments, blockedEmployees: blocked.size, employeesWithLimitedPeers, alreadyProcessed: false};
    }, {timeout: 30000, maxWait: 10000});
  }

  async milestone(userId: string, orgId: string, teamId: string, questionIds: string[] | undefined, membershipIds: string[], closesAt: Date) {
    await this.workspace.teamScope(userId, orgId, teamId, true);
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const now = this.clock.now();
      if (closesAt <= now) throw new BadRequestException('Deadline must be in the future');
      const adaptive = questionIds === undefined;
      const pool = adaptive ? await this.adaptivePool(tx, orgId) : [];
      const context = adaptive ? await this.selectionContext(tx, orgId, now) : null;
      questionIds = questionIds ?? pool.map(q=>q.id);
      if (!adaptive) await this.checkQuestions(tx, orgId, questionIds);
      const team = await tx.team.findFirstOrThrow({where: {orgId, id: teamId}});
      const members = await tx.teamMember.findMany({where: {orgId, teamId, membershipId: {in: membershipIds}, joinedAt: {lt: now}, membership: {active: true, role: {not: 'HR_ADMIN'}}}, orderBy: {joinedAt: 'desc'}});
      const pairs: {respondentId: string; subjectId: string}[] = [];
      for (const respondent of membershipIds) for (const subject of membershipIds) if (respondent !== subject) {
        let found = false;
        for (const a of members.filter(m => m.membershipId === respondent)) {
          for (const b of members.filter(m => m.membershipId === subject)) {
            const start = Math.max(a.joinedAt.getTime(), b.joinedAt.getTime(), team.startsAt.getTime());
            const end = Math.min(a.leftAt?.getTime() ?? now.getTime(), b.leftAt?.getTime() ?? now.getTime(), team.endsAt?.getTime() ?? now.getTime(), now.getTime());
            if (start < end) { pairs.push({respondentId: a.id, subjectId: b.id}); found = true; break; }
          }
          if (found) break;
        }
      }
      if (membershipIds.some(id => !pairs.some(p => members.find(m => m.id === p.respondentId)?.membershipId === id))) throw new BadRequestException('Selected participants must have overlapping team participation');
      const {policy} = await this.policy(tx, orgId, now);
      const selectedPairs = membershipIds.flatMap(id => shuffled(pairs.filter(p => members.find(m => m.id === p.respondentId)?.membershipId === id)).slice(0, policy.colleaguesPerPeriod));
      const survey = await tx.survey.create({data: {orgId, teamId, kind: 'MILESTONE', opensAt: now, closesAt, questionSelection: adaptive ? 'ADAPTIVE' : 'MANUAL'}});
      await tx.surveyQuestion.createMany({data: questionIds.map((id, i) => ({orgId, surveyId: survey.id, questionVersionId: id, position: i + 1}))});
      for (const pair of selectedPairs) {
        const author = members.find(m=>m.id===pair.respondentId)!.membershipId;
        const subject = members.find(m=>m.id===pair.subjectId)!.membershipId;
        const assignedIds = context ? selectQuestions(pool, context.evidence, context.pending, author, subject, now.getTime()) : [];
        await tx.assignment.create({data:{orgId,teamId,surveyId:survey.id,respondentTeamMemberId:pair.respondentId,subjectTeamMemberId:pair.subjectId,questionVersionIds:assignedIds,createdAt:now}});
        if(context) context.pending.push(...assignedIds.map(id=>({author,subject,time:now.getTime(),question:pool.find(q=>q.id===id)!})));
      }
      return {id: survey.id, opensAt: survey.opensAt, closesAt: survey.closesAt, createdAssignments: selectedPairs.length};
    }, {timeout: 30000});
  }

  private async ownAssignment(tx: Tx, userId: string, orgId: string, assignmentId: string) {
    const assignment = await tx.assignment.findFirst({where: {id: assignmentId, orgId, respondent: {membership: {userId, active: true}}}, include: {credit: true, replacement: {select: {id: true}}, respondent: true, subject: {include: {membership: {include: {user: {select: {displayName: true}}}}}}, survey: {include: {team: true, SurveyQuestion_survey: {include: {question: true}, orderBy: {position: 'asc'}}}}}});
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  async openAssignments(userId: string, orgId: string) {
    await this.workspace.member(userId, orgId);
    const now = this.clock.now();
    const assignments = await this.db.assignment.findMany({where: {orgId, status: 'OPEN', respondent: {membership: {userId, active: true}}, survey: {opensAt: {lte: now}, OR: [{closesAt: null}, {closesAt: {gt: now}}]}}, include: {credit: true, replacement: {select: {id: true}}, respondent: true, subject: {include: {membership: {include: {user: {select: {displayName: true}}}}}}, survey: {include: {team: true}}}, orderBy: {createdAt: 'asc'}});
    return assignments.map(a => ({id: a.id, teamId: a.teamId, teamName: a.survey.team.name, type: a.survey.kind, subject: {membershipId: a.subject.membershipId, displayName: a.subject.membership.user.displayName}, requiresReplacement: !a.subject.membership.active, closesAt: a.survey.closesAt}));
  }

  async detail(userId: string, orgId: string, assignmentId: string) {
    await this.workspace.member(userId, orgId);
    const a = await this.ownAssignment(this.db, userId, orgId, assignmentId);
    return {id: a.id, type: a.survey.kind, team: {id: a.teamId, name: a.survey.team.name}, subject: {membershipId: a.subject.membershipId, displayName: a.subject.membership.user.displayName}, opensAt: a.survey.opensAt, closesAt: a.survey.closesAt, submittedAt: a.submittedAt, requiresReplacement: !a.subject.membership.active, status: a.status, closedAt: a.closedAt, replacementAssignmentId: a.replacement?.id ?? null, participationPercentage: a.credit?.percentage ?? null, surveyFormat: {...SURVEY_FORMAT, questionCount: this.assignedQuestions(a).length}, questions: this.assignedQuestions(a).map(q => ({id: q.questionVersionId, text: q.question.text, dimension: q.question.dimension, notObservedRating: null, scaleMin: 1, scaleMax: 5}))};
  }

  private async lockedOwn(tx: Tx, userId: string, orgId: string, assignmentId: string) {
    await this.lock(tx, orgId);
    await tx.$queryRaw`SELECT a.id FROM "Assignment" a JOIN "TeamMember" tm ON tm.id=a."respondentTeamMemberId" JOIN "Membership" m ON m.id=tm."membershipId" WHERE a.id=${assignmentId}::uuid AND a."orgId"=${orgId}::uuid AND m."userId"=${userId}::uuid AND m.active FOR UPDATE OF a`;
    return this.ownAssignment(tx, userId, orgId, assignmentId);
  }

  private assertOpen(a: Awaited<ReturnType<SurveyService['ownAssignment']>>, requireParticipation = true) {
    if (a.status !== 'OPEN' || a.submittedAt) throw new ConflictException('Assignment is already closed');
    const now = this.clock.now();
    if (now < a.survey.opensAt || (a.survey.closesAt && now >= a.survey.closesAt)) throw new ConflictException('Survey is not open');
    if (requireParticipation && !a.subject.membership.active) throw new ConflictException('Team participation has ended');
  }

  private async recordCredit(tx: Tx, a: Awaited<ReturnType<SurveyService['ownAssignment']>>, outcome: 'COMPLETED' | 'SKIPPED') {
    let rootId = a.id;
    let next = a.replacesAssignmentId;
    const seen = new Set([a.id]);
    while (next) {
      if (seen.has(next)) throw new ConflictException('Invalid replacement history');
      seen.add(next);
      const parent = await tx.assignment.findFirstOrThrow({where: {id: next, orgId: a.orgId}, select: {id: true, replacesAssignmentId: true}});
      rootId = parent.id; next = parent.replacesAssignmentId;
    }
    await tx.participationCredit.create({data: {orgId: a.orgId, membershipId: a.respondent.membershipId, assignmentId: a.id, rootAssignmentId: rootId, outcome, percentage: outcome === 'COMPLETED' ? 100 : 60}});
  }

  async participation(userId: string, orgId: string) {
    const member = await this.workspace.member(userId, orgId);
    return this.db.participationCredit.findMany({where: {orgId, membershipId: member.id}, select: {id: true, assignmentId: true, outcome: true, percentage: true, createdAt: true}, orderBy: [{createdAt: 'desc'}, {id: 'asc'}], take: 200});
  }

  async skip(userId: string, orgId: string, assignmentId: string) {
    await this.workspace.member(userId, orgId);
    return this.db.$transaction(async tx => {
      const a = await this.lockedOwn(tx, userId, orgId, assignmentId);
      this.assertOpen(a);
      const closedAt = this.clock.now();
      await tx.assignment.update({where: {id: a.id}, data: {status: 'SKIPPED', closedAt}});
      await this.recordCredit(tx, a, 'SKIPPED');
      return {ok: true, status: 'SKIPPED', closedAt, participationPercentage: 60};
    });
  }

  async replace(userId: string, orgId: string, assignmentId: string) {
    await this.workspace.member(userId, orgId);
    return this.db.$transaction(async tx => {
      const a = await this.lockedOwn(tx, userId, orgId, assignmentId);
      this.assertOpen(a, false);
      const now = this.clock.now();
      const scope: Prisma.AssignmentWhereInput = a.survey.kind === 'MILESTONE' ? {surveyId: a.surveyId} : {survey: {kind: a.survey.kind, opensAt: a.survey.opensAt}};
      const used = await tx.assignment.findMany({where: {orgId, ...scope, respondent: {membershipId: a.respondent.membershipId}}, select: {subject: {select: {membershipId: true}}}});
      const excluded = new Set([a.respondent.membershipId, ...used.map(p => p.subject.membershipId)]);
      type Peer = {teamId: string; respondentId: string; subjectId: string};
      const peers = new Map<string, Peer>();
      if (a.survey.kind === 'MILESTONE') {
        // Stay inside the manager's originally selected participant group.
        const original = await tx.assignment.findMany({where: {orgId, surveyId: a.surveyId, replacesAssignmentId: null}, include: {respondent: {include: {membership: true}}}});
        for (const entry of original) {
          const p = entry.respondent;
          if (excluded.has(p.membershipId) || !p.membership.active || p.membership.role === 'HR_ADMIN') continue;
          const start = Math.max(a.respondent.joinedAt.getTime(), p.joinedAt.getTime(), a.survey.team.startsAt.getTime());
          const end = Math.min(a.respondent.leftAt?.getTime() ?? now.getTime(), p.leftAt?.getTime() ?? now.getTime(), a.survey.team.endsAt?.getTime() ?? now.getTime(), now.getTime());
          if (start < end) peers.set(p.membershipId, {teamId: a.teamId, respondentId: a.respondent.id, subjectId: p.id});
        }
      } else {
        const teams = await tx.team.findMany({where: {orgId, startsAt: {lte: now}, OR: [{endsAt: null}, {endsAt: {gt: now}}], TeamMember_team: {some: {membershipId: a.respondent.membershipId, joinedAt: {lte: now}, leftAt: null}}}, include: {TeamMember_team: {where: {joinedAt: {lte: now}, leftAt: null, membership: {active: true, role: {not: 'HR_ADMIN'}}}}}});
        for (const team of teams) {
          const respondent = team.TeamMember_team.find(p => p.membershipId === a.respondent.membershipId);
          if (!respondent) continue;
          for (const p of team.TeamMember_team) if (!excluded.has(p.membershipId) && !peers.has(p.membershipId)) peers.set(p.membershipId, {teamId: team.id, respondentId: respondent.id, subjectId: p.id});
        }
      }
      const selected = shuffled([...peers.values()])[0];
      const closedAt = this.clock.now();
      if (!selected) {
        await tx.assignment.update({where: {id: a.id}, data: {status: 'NO_REPLACEMENT', closedAt}});
        return {outcome: 'NO_REPLACEMENT', replacementAssignmentId: null, participationPercentage: null};
      }
      let surveyId = a.surveyId;
      if (selected.teamId !== a.teamId) {
        const questionIds = a.survey.SurveyQuestion_survey.map(q => q.questionVersionId);
        let survey = await tx.survey.findFirst({where: {orgId, teamId: selected.teamId, kind: a.survey.kind, opensAt: a.survey.opensAt}, include: {SurveyQuestion_survey: {orderBy: {position: 'asc'}}}});
        if (!survey) {
          const created = await tx.survey.create({data: {orgId, teamId: selected.teamId, kind: a.survey.kind, opensAt: a.survey.opensAt, closesAt: a.survey.closesAt, generationId: a.survey.generationId, questionSelection: a.survey.questionSelection}});
          await tx.surveyQuestion.createMany({data: questionIds.map((id, i) => ({orgId, surveyId: created.id, questionVersionId: id, position: i + 1}))});
          surveyId = created.id;
        } else {
          if (survey.questionSelection !== a.survey.questionSelection || (survey.closesAt?.getTime() ?? null) !== (a.survey.closesAt?.getTime() ?? null) || JSON.stringify(survey.SurveyQuestion_survey.map(q => q.questionVersionId)) !== JSON.stringify(questionIds)) throw new ConflictException('Replacement context does not match');
          surveyId = survey.id;
        }
      }
      await tx.assignment.update({where: {id: a.id}, data: {status: 'REPLACED', closedAt}});
      let assignedIds: string[] = [];
      if (a.survey.questionSelection === 'ADAPTIVE') {
        const pool = await this.adaptivePool(tx, orgId, a.survey.SurveyQuestion_survey.map(q=>q.questionVersionId));
        const context = await this.selectionContext(tx, orgId, now);
        const subject = await tx.teamMember.findUniqueOrThrow({where:{id:selected.subjectId}});
        assignedIds = selectQuestions(pool,context.evidence,context.pending,a.respondent.membershipId,subject.membershipId,now.getTime());
      }
      const replacement = await tx.assignment.create({data: {orgId, teamId: selected.teamId, surveyId, respondentTeamMemberId: selected.respondentId, subjectTeamMemberId: selected.subjectId, replacesAssignmentId: a.id, createdAt: now, questionVersionIds:assignedIds}, select: {id: true}});
      return {outcome: 'REPLACED', replacementAssignmentId: replacement.id, participationPercentage: null};
    }, {timeout: 15000, maxWait: 10000});
  }

  async submit(userId: string, orgId: string, assignmentId: string, answers: RatingAnswer[]) {
    await this.workspace.member(userId, orgId);
    return this.db.$transaction(async tx => {
      const a = await this.lockedOwn(tx, userId, orgId, assignmentId);
      this.assertOpen(a);
      const now = this.clock.now();
      const expected = this.assignedQuestions(a).map(q => q.questionVersionId);
      if (answers.length !== expected.length || answers.some(answer => !expected.includes(answer.questionVersionId))) throw new BadRequestException('Answer every assigned question exactly once');
      await tx.answer.createMany({data: answers.map(answer => ({orgId, surveyId: a.surveyId, assignmentId, questionVersionId: answer.questionVersionId, rating: answer.rating}))});
      await tx.assignment.update({where: {id: assignmentId}, data: {submittedAt: now, status: 'COMPLETED', closedAt: now}});
      await this.recordCredit(tx, a, 'COMPLETED');
      await this.insights.refresh(tx, orgId, [a.subject.membershipId], [[a.respondent.membershipId, a.subject.membershipId]], now);
      return {ok: true, submittedAt: now, participationPercentage: 100};
    }, {timeout: 30000, maxWait: 10000});
  }
}
