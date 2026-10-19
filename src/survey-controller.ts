import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthRequest } from './auth.js';
import { type ScheduleInput, SurveyService } from './surveys.js';
import * as input from './input.js';
import { QuestionService } from './questions.js';

function ids(raw: unknown, min: number, max: number): string[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) throw new BadRequestException(`Expected ${min}–${max} identifiers`);
  const values = raw.map(input.uuid);
  if (new Set(values).size !== values.length) throw new BadRequestException('Duplicate identifier');
  return values;
}

@Controller('organizations/:orgId')
@UseGuards(AuthGuard)
export class SurveyController {
  constructor(private readonly surveys: SurveyService, private readonly questionLibrary: QuestionService) {}

  @Get('feedback-policy')
  schedule(@Req() req: AuthRequest, @Param('orgId') org: string) { return this.surveys.schedule(req.actor.userId, input.uuid(org)); }

  @Patch('feedback-policy')
  policy(@Req() req: AuthRequest, @Param('orgId') org: string, @Body() raw: unknown) {
    const value = input.body(raw, ['frequency', 'periodDays', 'colleaguesPerPeriod', 'timeZone', 'weekday', 'monthDay', 'generationTime', 'automaticEnabled', 'questionVersionIds', 'questionSelection']);
    if (value.frequency !== undefined && value.periodDays !== undefined) throw new BadRequestException('Use frequency or the legacy periodDays field, not both');
    let frequency = value.frequency;
    if (value.periodDays !== undefined) {
      if (value.periodDays !== 7 && value.periodDays !== 14 && value.periodDays !== 30) throw new BadRequestException('Choose weekly, fortnightly or monthly');
      frequency = value.periodDays === 7 ? 'WEEKLY' : value.periodDays === 14 ? 'FORTNIGHTLY' : 'MONTHLY';
    }
    if (frequency !== undefined && frequency !== 'WEEKLY' && frequency !== 'FORTNIGHTLY' && frequency !== 'MONTHLY') throw new BadRequestException('Invalid frequency');
    if (value.colleaguesPerPeriod !== undefined && value.colleaguesPerPeriod !== 1 && value.colleaguesPerPeriod !== 2) throw new BadRequestException('Choose one or two colleagues');
    const change: ScheduleInput = {frequency: frequency as ScheduleInput['frequency'], colleaguesPerPeriod: value.colleaguesPerPeriod as number | undefined};
    if (value.timeZone !== undefined) {
      change.timeZone = input.text(value.timeZone, 'timezone', 100);
      try { if (/^[+-]/.test(change.timeZone)) throw new Error(); new Intl.DateTimeFormat('en', {timeZone: change.timeZone}).format(); }
      catch { throw new BadRequestException('Use a valid IANA timezone'); }
    }
    for (const [key, maximum] of [['weekday', 7], ['monthDay', 31]] as const) {
      const item = value[key];
      if (item !== undefined) { if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > maximum) throw new BadRequestException(`Invalid ${key}`); change[key] = item; }
    }
    if (value.generationTime !== undefined) {
      if (typeof value.generationTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.generationTime)) throw new BadRequestException('Use HH:mm generation time');
      change.generationTime = value.generationTime;
    }
    if (value.automaticEnabled !== undefined) { if (typeof value.automaticEnabled !== 'boolean') throw new BadRequestException('Invalid automaticEnabled'); change.automaticEnabled = value.automaticEnabled; }
    if (value.questionSelection !== undefined) {
      if (value.questionSelection !== 'MANUAL' && value.questionSelection !== 'ADAPTIVE') throw new BadRequestException('Choose MANUAL or ADAPTIVE question selection');
      change.questionSelection = value.questionSelection;
    }
    if (value.questionVersionIds !== undefined) change.questionVersionIds = ids(value.questionVersionIds, 0, 5);
    return this.surveys.setSchedule(req.actor.userId, input.uuid(org), change);
  }

  @Get('skills')
  skills(@Req() req: AuthRequest, @Param('orgId') org: string) { return this.surveys.skills(req.actor.userId, input.uuid(org)); }

  @Post('skills')
  createSkill(@Req() req: AuthRequest, @Param('orgId') org: string, @Body() raw: unknown) {
    const value = input.body(raw, ['name']);
    return this.surveys.createSkill(req.actor.userId, input.uuid(org), input.text(value.name, 'skill name'));
  }

  @Get('questions')
  questions(@Req() req: AuthRequest, @Param('orgId') org: string) { return this.questionLibrary.list(req.actor.userId, input.uuid(org)); }

  @Post('questions')
  createQuestion(@Req() req: AuthRequest, @Param('orgId') org: string, @Body() raw: unknown) {
    const value = input.body(raw, ['questionKey', 'text', 'skillWeights', 'dimension']);
    const dimension = value.dimension;
    if (dimension !== undefined && dimension !== 'UNSPECIFIED' && dimension !== 'SKILL' && dimension !== 'CHEMISTRY_ENJOYMENT' && dimension !== 'CHEMISTRY_EFFECTIVENESS') throw new BadRequestException('Invalid question dimension');
    const weights = value.skillWeights ?? [];
    if (!Array.isArray(weights) || weights.length > 10) throw new BadRequestException('Invalid skill weights');
    const skillWeights = weights.map(rawWeight => {
      const weight = input.body(rawWeight, ['skillId', 'weight']);
      if (typeof weight.weight !== 'number' || !Number.isFinite(weight.weight) || weight.weight <= 0 || weight.weight > 1 || Math.abs(weight.weight * 10000 - Math.round(weight.weight * 10000)) > 0.000001) throw new BadRequestException('Weights must be positive, at most one, with up to four decimal places');
      return {skillId: input.uuid(weight.skillId), weight: weight.weight};
    });
    if (new Set(skillWeights.map(w => w.skillId)).size !== skillWeights.length || (skillWeights.length && skillWeights.reduce((sum, w) => sum + Math.round(w.weight * 10000), 0) !== 10000)) throw new BadRequestException('Distinct skill weights must sum to one');
    return this.questionLibrary.create(req.actor.userId, input.uuid(org), input.text(value.questionKey, 'question key'), input.text(value.text, 'question text', 1000), skillWeights, dimension);
  }

  @Get('questions/standard-library')
  standardLibrary(@Req() req: AuthRequest, @Param('orgId') org: string) {
    return this.questionLibrary.library(req.actor.userId, input.uuid(org));
  }

  @Post('questions/import-standard') @HttpCode(200)
  importStandard(@Req() req: AuthRequest, @Param('orgId') org: string, @Body() raw: unknown) {
    input.body(raw ?? {}, []);
    return this.questionLibrary.importStandard(req.actor.userId, input.uuid(org));
  }

  @Post('questions/:questionId/review') @HttpCode(200)
  reviewQuestion(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('questionId') id: string, @Body() raw: unknown) {
    const value = input.body(raw, ['decision', 'note']);
    if (value.decision !== 'APPROVED' && value.decision !== 'REJECTED') throw new BadRequestException('Choose APPROVED or REJECTED');
    return this.questionLibrary.review(req.actor.userId, input.uuid(org), input.uuid(id), value.decision, value.note === undefined ? undefined : input.text(value.note, 'review note', 1000));
  }

  @Post('surveys/generate-periodic') @HttpCode(200)
  periodic(@Req() req: AuthRequest, @Param('orgId') org: string, @Body() raw: unknown) {
    const value = input.body(raw, ['questionVersionIds']);
    return this.surveys.periodic(req.actor.userId, input.uuid(org), value.questionVersionIds === undefined ? undefined : ids(value.questionVersionIds, 5, 5));
  }

  @Post('teams/:teamId/surveys/milestone')
  milestone(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('teamId') team: string, @Body() raw: unknown) {
    const value = input.body(raw, ['questionVersionIds', 'participantMembershipIds', 'closesAt']);
    return this.surveys.milestone(req.actor.userId, input.uuid(org), input.uuid(team), value.questionVersionIds === undefined ? undefined : ids(value.questionVersionIds, 5, 5), ids(value.participantMembershipIds, 2, 30), input.date(value.closesAt));
  }

  @Get('assignments/my-open')
  open(@Req() req: AuthRequest, @Param('orgId') org: string) { return this.surveys.openAssignments(req.actor.userId, input.uuid(org)); }

  @Get('assignments/:assignmentId')
  detail(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('assignmentId') assignment: string) { return this.surveys.detail(req.actor.userId, input.uuid(org), input.uuid(assignment)); }

  @Get('participation/my')
  participation(@Req() req: AuthRequest, @Param('orgId') org: string) { return this.surveys.participation(req.actor.userId, input.uuid(org)); }

  @Post('assignments/:assignmentId/skip') @HttpCode(200)
  skip(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('assignmentId') assignment: string, @Body() raw: unknown) {
    input.body(raw ?? {}, []);
    return this.surveys.skip(req.actor.userId, input.uuid(org), input.uuid(assignment));
  }

  @Post('assignments/:assignmentId/replace') @HttpCode(200)
  replace(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('assignmentId') assignment: string, @Body() raw: unknown) {
    input.body(raw ?? {}, []);
    return this.surveys.replace(req.actor.userId, input.uuid(org), input.uuid(assignment));
  }

  @Post('assignments/:assignmentId/submit') @HttpCode(200)
  submit(@Req() req: AuthRequest, @Param('orgId') org: string, @Param('assignmentId') assignment: string, @Body() raw: unknown) {
    const value = input.body(raw, ['answers']);
    if (!Array.isArray(value.answers) || value.answers.length < 1 || value.answers.length > 20) throw new BadRequestException('Expected 1–20 answers');
    const answers = value.answers.map(rawAnswer => {
      const answer = input.body(rawAnswer, ['questionVersionId', 'rating']);
      if (answer.rating !== null && (typeof answer.rating !== 'number' || !Number.isInteger(answer.rating) || answer.rating < 1 || answer.rating > 5)) throw new BadRequestException('Ratings must be integers from 1 to 5, or null for not observed');
      return {questionVersionId: input.uuid(answer.questionVersionId), rating: answer.rating as number | null};
    });
    if (new Set(answers.map(a => a.questionVersionId)).size !== answers.length) throw new BadRequestException('Duplicate answer');
    return this.surveys.submit(req.actor.userId, input.uuid(org), input.uuid(assignment), answers);
  }
}
