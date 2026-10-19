import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Database } from './database.js';
import { Clock } from './clock.js';
import { WorkspaceService } from './workspace.js';
import { STANDARD_LIBRARY_VERSION, STANDARD_QUESTIONS } from './standard-questions.js';
import type { QuestionDimension } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
export type SkillWeight = {skillId: string; weight: number};
const fields = {
  id: true, questionKey: true, version: true, text: true, kind: true, dimension: true, active: true,
  approvalStatus: true, approvalOrigin: true, createdByMembershipId: true,
  reviewedByMembershipId: true, reviewedAt: true, reviewNote: true, standardTemplateKey: true,
  QuestionSkill_question: {select: {skillId: true, weight: true}},
} as const;

@Injectable()
export class QuestionService {
  constructor(private readonly db: Database, private readonly workspace: WorkspaceService, private readonly clock: Clock) {}

  private async actor(tx: Tx, userId: string, orgId: string, hr = false) {
    const member = await tx.membership.findUnique({where: {orgId_userId: {orgId, userId}}});
    if (!member?.active) throw new NotFoundException('Organization not found');
    if (hr && member.role !== 'HR_ADMIN') throw new ForbiddenException('An HR administrator must review questions');
    return member;
  }

  private async author(tx: Tx, userId: string, orgId: string) {
    const member = await this.actor(tx, userId, orgId);
    if (member.role === 'OWNER' || member.role === 'HR_ADMIN') return member;
    const now = this.clock.now();
    const access = await tx.teamAccess.findFirst({where: {orgId, membershipId: member.id,
      team: {startsAt: {lte: now}, OR: [{endsAt: null}, {endsAt: {gt: now}}]},
      OR: [{role: 'MANAGER'}, {role: 'TEAM_LEADER', team: {TeamMember_team: {some: {membershipId: member.id, joinedAt: {lte: now}, leftAt: null}}}}],
    }});
    if (!access) throw new ForbiddenException('Only managers and team leaders can propose questions');
    return member;
  }

  private async lock(tx: Tx, orgId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`;
  }

  private async weights(tx: Tx, orgId: string, weights: SkillWeight[]) {
    if (await tx.skill.count({where: {orgId, id: {in: weights.map(w => w.skillId)}, active: true}}) !== weights.length) throw new BadRequestException('Skills must be active and belong to this company');
  }

  async list(userId: string, orgId: string) {
    const member = await this.workspace.member(userId, orgId);
    const visibility = member.role === 'HR_ADMIN' || member.role === 'OWNER' ? {} : {
      OR: [{approvalStatus: 'APPROVED' as const}, {createdByMembershipId: member.id}],
    };
    return this.db.questionVersion.findMany({where: {orgId, ...visibility}, select: fields, orderBy: [{questionKey: 'asc'}, {version: 'desc'}]});
  }

  async create(userId: string, orgId: string, questionKey: string, text: string, skillWeights: SkillWeight[], requestedDimension?: QuestionDimension) {
    const dimension = requestedDimension ?? (skillWeights.length ? 'SKILL' : 'UNSPECIFIED');
    if (dimension !== 'SKILL' && skillWeights.length) throw new BadRequestException('Only skill questions can have skill weights');
    if (dimension === 'SKILL' && !skillWeights.length) throw new BadRequestException('A skill question needs at least one skill mapping');
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const member = await this.author(tx, userId, orgId);
      await this.weights(tx, orgId, skillWeights);
      const previous = await tx.questionVersion.findFirst({where: {orgId, questionKey}, orderBy: {version: 'desc'}});
      const question = await tx.questionVersion.create({data: {orgId, questionKey, version: (previous?.version ?? 0) + 1, text, dimension, createdByMembershipId: member.id}});
      if (skillWeights.length) await tx.questionSkill.createMany({data: skillWeights.map(w => ({orgId, questionVersionId: question.id, ...w}))});
      return tx.questionVersion.findUniqueOrThrow({where: {id: question.id}, select: fields});
    });
  }

  async review(userId: string, orgId: string, id: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const reviewer = await this.actor(tx, userId, orgId, true);
      const question = await tx.questionVersion.findFirst({where: {orgId, id}, include: {QuestionSkill_question: true}});
      if (!question) throw new NotFoundException('Question not found');
      if (question.approvalStatus !== 'DRAFT') throw new ConflictException('This version has already been reviewed; create a new version for changes');
      if (decision === 'APPROVED') {
        if (!question.active) throw new BadRequestException('An inactive question cannot be approved');
        const weights = question.QuestionSkill_question.map(w => ({skillId: w.skillId, weight: Number(w.weight)}));
        await this.weights(tx, orgId, weights);
        if (weights.length && weights.reduce((sum, w) => sum + Math.round(w.weight * 10000), 0) !== 10000) throw new BadRequestException('Skill weights must sum to one');
      }
      return tx.questionVersion.update({where: {id}, data: {approvalStatus: decision, approvalOrigin: 'HR', reviewedByMembershipId: reviewer.id, reviewedAt: this.clock.now(), reviewNote: note ?? null}, select: fields});
    });
  }

  async library(userId: string, orgId: string) {
    await this.workspace.member(userId, orgId);
    return {version: STANDARD_LIBRARY_VERSION, context: 'During your recent work together', ratingRange: {min: 1, max: 5}, notObservedRating: null, questions: STANDARD_QUESTIONS};
  }

  async importStandard(userId: string, orgId: string) {
    return this.db.$transaction(async tx => {
      await this.lock(tx, orgId);
      const reviewer = await this.actor(tx, userId, orgId, true);
      const imported = [];
      let created = 0;
      for (const template of STANDARD_QUESTIONS) {
        let question = await tx.questionVersion.findUnique({where: {orgId_standardTemplateKey: {orgId, standardTemplateKey: template.templateKey}}});
        if (!question) {
          const skill = template.skillName ? await tx.skill.upsert({where: {orgId_name: {orgId, name: template.skillName}}, create: {orgId, name: template.skillName}, update: {}}) : null;
          if (skill && !skill.active) throw new BadRequestException(`Reactivate the ${template.skillName} skill before importing the library`);
          const previous = await tx.questionVersion.findFirst({where: {orgId, questionKey: template.questionKey}, orderBy: {version: 'desc'}});
          question = await tx.questionVersion.create({data: {orgId, questionKey: template.questionKey, version: (previous?.version ?? 0) + 1, text: template.text, dimension: template.dimension, createdByMembershipId: reviewer.id, standardTemplateKey: template.templateKey}});
          if (skill) await tx.questionSkill.create({data: {orgId, questionVersionId: question.id, skillId: skill.id, weight: 1}});
          question = await tx.questionVersion.update({where: {id: question.id}, data: {approvalStatus: 'APPROVED', approvalOrigin: 'STANDARD', reviewedByMembershipId: reviewer.id, reviewedAt: this.clock.now()}});
          created++;
        }
        imported.push({id: question.id, templateKey: template.templateKey});
      }
      return {libraryVersion: STANDARD_LIBRARY_VERSION, createdQuestions: created, questions: imported};
    }, {timeout: 15000});
  }
}
