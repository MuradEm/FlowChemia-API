import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, AuthService, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { WorkspaceService } from './workspace.js';
import * as input from './input.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: Database, private readonly workspace: WorkspaceService) {}

  @Get('health')
  async health() { await this.db.$queryRaw`SELECT 1`; return {status:'ok'}; }

  @Post('auth/login') @HttpCode(200)
  async login(@Req() request: Request, @Body() raw: unknown) {
    this.auth.throttle(`login:${request.ip}`);
    const value = input.body(raw,['email','password']);
    return this.auth.login(input.email(value.email),input.password(value.password));
  }
  @Post('auth/logout') @HttpCode(200) @UseGuards(AuthGuard)
  async logout(@Req() request: AuthRequest) {
    await this.db.session.deleteMany({where:{id:request.actor.sessionId,userId:request.actor.userId}});
    return {ok:true};
  }
  @Get('me') @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest) { return this.workspace.me(request.actor.userId); }

  @Post('invitations/accept')
  async accept(@Req() request: Request, @Body() raw: unknown) {
    this.auth.throttle(`invite:${request.ip}`);
    const value = input.body(raw,['token','displayName','password']);
    const token = input.text(value.token,'invitation token',43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException('Invalid invitation token');
    const actor = request.headers.authorization ? await this.auth.authenticate(request.headers.authorization) : undefined;
    return this.workspace.acceptInvite(token,value.displayName===undefined?undefined:input.text(value.displayName,'display name'),value.password===undefined?undefined:input.password(value.password),actor?.userId);
  }
}

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private readonly workspace: WorkspaceService) {}
  @Post()
  create(@Req() req: AuthRequest, @Body() raw: unknown) {
    const value=input.body(raw,['name']);
    return this.workspace.createOrganization(req.actor.userId,input.text(value.name,'company name'));
  }
  @Get(':orgId')
  get(@Req() req: AuthRequest,@Param('orgId') org: string) { return this.workspace.organization(req.actor.userId,input.uuid(org)); }
  @Get(':orgId/members')
  members(@Req() req: AuthRequest,@Param('orgId') org: string) { return this.workspace.members(req.actor.userId,input.uuid(org)); }
  @Post(':orgId/invitations')
  invite(@Req() req: AuthRequest,@Param('orgId') org: string,@Body() raw: unknown) {
    const value=input.body(raw,['email','role']);
    const role=value.role??'EMPLOYEE';
    if (role!=='EMPLOYEE' && role!=='HR_ADMIN') throw new BadRequestException('Invalid invitation role');
    return this.workspace.invite(req.actor.userId,input.uuid(org),input.email(value.email),role);
  }
  @Get(':orgId/teams')
  teams(@Req() req: AuthRequest,@Param('orgId') org: string) {return this.workspace.teams(req.actor.userId,input.uuid(org));}
  @Post(':orgId/teams')
  createTeam(@Req() req: AuthRequest,@Param('orgId') org: string,@Body() raw: unknown) {
    const value=input.body(raw,['name','startsAt','endsAt']);
    return this.workspace.createTeam(req.actor.userId,input.uuid(org),input.text(value.name,'team name'),value.startsAt===undefined?new Date():input.date(value.startsAt),value.endsAt===undefined?undefined:input.date(value.endsAt));
  }
  @Get(':orgId/teams/:teamId')
  team(@Req() req: AuthRequest,@Param('orgId') org: string,@Param('teamId') team: string) {return this.workspace.team(req.actor.userId,input.uuid(org),input.uuid(team));}
  @Post(':orgId/teams/:teamId/members')
  add(@Req() req: AuthRequest,@Param('orgId') org: string,@Param('teamId') team: string,@Body() raw: unknown) {
    const value=input.body(raw,['membershipId']);
    return this.workspace.addMember(req.actor.userId,input.uuid(org),input.uuid(team),input.uuid(value.membershipId));
  }
  @Delete(':orgId/teams/:teamId/members/:membershipId')
  remove(@Req() req: AuthRequest,@Param('orgId') org: string,@Param('teamId') team: string,@Param('membershipId') membership: string) {
    return this.workspace.removeMember(req.actor.userId,input.uuid(org),input.uuid(team),input.uuid(membership));
  }
  @Post(':orgId/teams/:teamId/access')
  grant(@Req() req: AuthRequest,@Param('orgId') org: string,@Param('teamId') team: string,@Body() raw: unknown) {
    const value=input.body(raw,['membershipId','role']);
    if (value.role!=='MANAGER' && value.role!=='TEAM_LEADER') throw new BadRequestException('Invalid team role');
    return this.workspace.grant(req.actor.userId,input.uuid(org),input.uuid(team),input.uuid(value.membershipId),value.role);
  }
  @Delete(':orgId/teams/:teamId/access/:membershipId')
  revoke(@Req() req: AuthRequest,@Param('orgId') org: string,@Param('teamId') team: string,@Param('membershipId') membership: string) {
    return this.workspace.revoke(req.actor.userId,input.uuid(org),input.uuid(team),input.uuid(membership));
  }
}
