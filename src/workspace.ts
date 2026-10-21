import type { Prisma } from '../generated/prisma/client.js';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Database } from './database.js';
import { hashPassword, tokenHash, newToken } from './password.js';

@Injectable()
export class WorkspaceService {
  constructor(private readonly db: Database) {}

  async member(userId: string, orgId: string, db: Prisma.TransactionClient = this.db) {
    const member = await db.membership.findUnique({where: {orgId_userId: {orgId,userId}}});
    if (!member?.active) throw new NotFoundException('Organization not found');
    return member;
  }
  async admin(userId: string, orgId: string, db: Prisma.TransactionClient = this.db) {
    const member = await this.member(userId, orgId, db);
    if (!['OWNER','HR_ADMIN'].includes(member.role)) throw new ForbiddenException();
    return member;
  }
  async me(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({where: {id:userId}, select: {id:true, email:true, displayName:true}});
    const memberships = await this.db.membership.findMany({where: {userId,active:true},select: {id:true,role:true,organization:{select:{id:true,name:true}}}});
    return {user,memberships};
  }
  async createOrganization(userId: string, name: string) {
    return this.db.$transaction(async tx => {
      const organization = await tx.organization.create({data:{name},select:{id:true,name:true}});
      const membership = await tx.membership.create({data:{orgId:organization.id,userId,role:'OWNER'},select:{id:true,role:true}});
      return {organization,membership};
    });
  }
  async organization(userId: string, orgId: string) {
    await this.member(userId,orgId);
    return this.db.organization.findUniqueOrThrow({where:{id:orgId},select:{id:true,name:true,testMode:true}});
  }
  async members(userId: string, orgId: string) {
    await this.admin(userId,orgId);
    return this.db.membership.findMany({where:{orgId},select:{id:true,role:true,active:true,user:{select:{id:true,displayName:true,email:true}}},orderBy:{createdAt:'asc'},take:200});
  }
  async invite(userId: string, orgId: string, email: string, role: 'EMPLOYEE'|'HR_ADMIN') {
    const sender = await this.admin(userId,orgId);
    if (role === 'HR_ADMIN' && sender.role !== 'OWNER') throw new ForbiddenException('Only the owner can invite an HR administrator');
    const existing = await this.db.membership.findFirst({where:{orgId,user:{email}}});
    if (existing) throw new ConflictException('Already a company member');
    const token = newToken();
    const expiresAt = new Date(Date.now()+48*60*60*1000);
    const invitation = await this.db.invitation.create({data:{orgId,email,role,tokenHash:tokenHash(token),invitedByMembershipId:sender.id,expiresAt},select:{id:true,email:true,role:true,expiresAt:true}});
    // Temporary development delivery. Never expose this token in lists or logs.
    return {invitation,token};
  }
  async acceptInvite(token: string, displayName: string | undefined, password: string | undefined, actorUserId?: string) {
    // Scrypt runs before the transaction, avoiding a long-held DB connection.
    const passwordHash = password ? await hashPassword(password) : undefined;
    return this.db.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({where:{tokenHash:tokenHash(token)},include:{sender:true}});
      if (!invitation || invitation.acceptedAt || invitation.expiresAt<=new Date() || !invitation.sender.active || !['OWNER','HR_ADMIN'].includes(invitation.sender.role) || (invitation.role==='HR_ADMIN' && invitation.sender.role!=='OWNER')) throw new BadRequestException('Invitation is invalid or expired');
      let user = await tx.user.findUnique({where:{email:invitation.email}});
      if (user) {
        if (actorUserId!==user.id) throw new UnauthorizedException('Sign in to the invited account first');
        if (password || displayName) throw new BadRequestException('Existing accounts must not supply new credentials');
      } else {
        if (actorUserId || !passwordHash || !displayName) throw new BadRequestException('A new account needs a display name and password');
        user = await tx.user.create({data:{email:invitation.email,displayName,credential:{create:{passwordHash}}}});
      }
      const claim = await tx.invitation.updateMany({where:{id:invitation.id,acceptedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date()}});
      if (claim.count!==1) throw new ConflictException('Invitation already used');
      const membership = await tx.membership.create({data:{orgId:invitation.orgId,userId:user.id,role:invitation.role},select:{id:true,orgId:true,role:true}});
      return {membership};
    });
  }
  async teamScope(userId: string, orgId: string, teamId: string, manage = false, db: Prisma.TransactionClient = this.db) {
    const member = await this.member(userId,orgId,db);
    const team = await db.team.findFirst({where:{id:teamId,orgId}});
    if (!team) throw new NotFoundException('Team not found');
    if (['OWNER','HR_ADMIN'].includes(member.role)) return team;
    const access = await db.teamAccess.findUnique({where:{orgId_teamId_membershipId:{orgId,teamId,membershipId:member.id}}});
    if (manage) {
      if (access?.role!=='MANAGER') throw new ForbiddenException();
    } else if (access?.role!=='MANAGER' && !await db.teamMember.findFirst({where:{orgId,teamId,membershipId:member.id,leftAt:null}})) throw new NotFoundException('Team not found');
    return team;
  }
  async teams(userId: string, orgId: string) {
    const member = await this.member(userId,orgId);
    const where = ['OWNER','HR_ADMIN'].includes(member.role) ? {orgId} : {orgId,OR:[{TeamMember_team:{some:{membershipId:member.id,leftAt:null}}},{TeamAccess_team:{some:{membershipId:member.id,role:'MANAGER' as const}}}]};
    return this.db.team.findMany({where,select:{id:true,name:true,startsAt:true,endsAt:true},orderBy:{createdAt:'asc'},take:200});
  }
  async createTeam(userId: string, orgId: string, name: string, startsAt: Date, endsAt?: Date) {
    await this.admin(userId,orgId);
    if (endsAt && endsAt<=startsAt) throw new BadRequestException('Team end must follow its start');
    return this.db.team.create({data:{orgId,name,startsAt,endsAt},select:{id:true,name:true,startsAt:true,endsAt:true}});
  }
  async team(userId: string, orgId: string, teamId: string) {
    const team = await this.teamScope(userId,orgId,teamId);
    const members = await this.db.teamMember.findMany({where:{orgId,teamId,leftAt:null,membership:{active:true}},select:{id:true,membershipId:true,joinedAt:true,membership:{select:{user:{select:{displayName:true}}}}}});
    const access = await this.db.teamAccess.findMany({where:{orgId,teamId,membership:{active:true}},select:{membershipId:true,role:true}});
    return {id:team.id,name:team.name,startsAt:team.startsAt,endsAt:team.endsAt,members:members.map(m=>({id:m.id,membershipId:m.membershipId,displayName:m.membership.user.displayName,joinedAt:m.joinedAt})),access};
  }
  async addMember(userId: string, orgId: string, teamId: string, membershipId: string) {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
      const team=await this.teamScope(userId,orgId,teamId,true,tx);
      if(team.endsAt&&team.endsAt<=new Date())throw new BadRequestException('Team has ended');
      const member=await tx.membership.findFirst({where:{id:membershipId,orgId,active:true}});
      if(!member)throw new NotFoundException('Employee not found');
      if(member.role==='HR_ADMIN')throw new BadRequestException('HR administrators must remain independent of teams');
      return tx.teamMember.create({data:{orgId,teamId,membershipId,joinedAt:new Date()},select:{id:true,membershipId:true,joinedAt:true}});
    });
  }
  async removeMember(userId: string, orgId: string, teamId: string, membershipId: string) {
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
      await this.teamScope(userId,orgId,teamId,true,tx);
      const changed=await tx.teamMember.updateMany({where:{orgId,teamId,membershipId,leftAt:null},data:{leftAt:new Date()}});
      if(!changed.count)throw new NotFoundException('Team member not found');
      await tx.teamAccess.deleteMany({where:{orgId,teamId,membershipId,role:'TEAM_LEADER'}});
    });return {ok:true};
  }
  async grant(userId: string, orgId: string, teamId: string, membershipId: string, role: 'MANAGER'|'TEAM_LEADER') {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
      await this.admin(userId,orgId,tx);await this.teamScope(userId,orgId,teamId,false,tx);
      const member=await tx.membership.findFirst({where:{id:membershipId,orgId,active:true}});
      if(!member)throw new NotFoundException('Employee not found');
      if(member.role==='HR_ADMIN')throw new BadRequestException('HR administrators must remain independent');
      if(role==='TEAM_LEADER'&&!await tx.teamMember.findFirst({where:{orgId,teamId,membershipId,leftAt:null}}))throw new BadRequestException('A team leader must participate in the team');
      return tx.teamAccess.upsert({where:{orgId_teamId_membershipId:{orgId,teamId,membershipId}},create:{orgId,teamId,membershipId,role},update:{role},select:{membershipId:true,role:true}});
    });
  }
  async revoke(userId: string, orgId: string, teamId: string, membershipId: string) {
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orgId},0))`;
      await this.admin(userId,orgId,tx);await this.teamScope(userId,orgId,teamId,false,tx);
      await tx.teamAccess.deleteMany({where:{orgId,teamId,membershipId}});
    });return {ok:true};
  }
}
