import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import sharp from "sharp";
import { Database } from "./database.js";
import { WorkspaceService } from "./workspace.js";
import { AuthGuard, type AuthRequest } from "./auth.js";
import * as input from "./input.js";

export const professionalFields = [
  "jobTitle",
  "department",
  "location",
  "workEmail",
  "workPhone",
] as const;
export type ProfessionalInfo = Partial<
  Record<(typeof professionalFields)[number], string | null>
>;
const select = {
  id: true,
  jobTitle: true,
  department: true,
  location: true,
  workEmail: true,
  workPhone: true,
  user: { select: { displayName: true } },
  photo: { select: { updatedAt: true } },
} as const;

@Injectable()
export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
  ) {}

  async list(userId: string, orgId: string) {
    const viewer = await this.workspace.member(userId, orgId);
    const now = new Date();
    const admin = viewer.role === "OWNER" || viewer.role === "HR_ADMIN";
    const teams = await this.db.team.findMany({
      where: {
        orgId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [
          {
            OR: [
              {
                TeamMember_team: {
                  some: {
                    membershipId: viewer.id,
                    leftAt: null,
                    joinedAt: { lte: now },
                  },
                },
              },
              {
                TeamAccess_team: {
                  some: { membershipId: viewer.id, role: "MANAGER" },
                },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });
    const people = await this.db.membership.findMany({
      where: {
        orgId,
        active: true,
        ...(admin
          ? {}
          : {
              OR: [
                { id: viewer.id },
                {
                  TeamMember_membership: {
                    some: {
                      teamId: { in: teams.map((t) => t.id) },
                      leftAt: null,
                      joinedAt: { lte: now },
                    },
                  },
                },
              ],
            }),
      },
      select,
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      take: 200,
    });
    return people.map((p) => ({
      membershipId: p.id,
      displayName: p.user.displayName,
      jobTitle: p.jobTitle,
      department: p.department,
      location: p.location,
      photoUpdatedAt: p.photo?.updatedAt ?? null,
    }));
  }
  private async scope(userId: string, orgId: string, targetId: string) {
    const viewer = await this.workspace.member(userId, orgId);
    const target = await this.db.membership.findFirst({
      where: { orgId, id: targetId, active: true },
      select,
    });
    if (!target) throw new NotFoundException("Employee not found");
    const now = new Date();
    const activeTeam = {
      orgId,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    };
    const teams = await this.db.team.findMany({
      where: {
        ...activeTeam,
        TeamMember_team: {
          some: {
            orgId,
            membershipId: targetId,
            joinedAt: { lte: now },
            leftAt: null,
          },
        },
      },
      select: { id: true },
    });
    const ids = teams.map((t) => t.id);
    const manages = !!(await this.db.teamAccess.findFirst({
      where: {
        orgId,
        membershipId: viewer.id,
        role: "MANAGER",
        teamId: { in: ids },
      },
    }));
    const admin = viewer.role === "OWNER" || viewer.role === "HR_ADMIN";
    const self = viewer.id === targetId;
    const shares = !!(await this.db.teamMember.findFirst({
      where: {
        orgId,
        membershipId: viewer.id,
        teamId: { in: ids },
        joinedAt: { lte: now },
        leftAt: null,
      },
    }));
    if (!self && !admin && !manages && !shares)
      throw new NotFoundException("Employee not found");
    return { target, canEditInfo: admin || manages, canEditPhoto: self };
  }
  private response(scope: Awaited<ReturnType<ProfileService["scope"]>>) {
    const { target, canEditInfo, canEditPhoto } = scope;
    return {
      membershipId: target.id,
      displayName: target.user.displayName,
      jobTitle: target.jobTitle,
      department: target.department,
      location: target.location,
      workEmail: target.workEmail,
      workPhone: target.workPhone,
      photoUpdatedAt: target.photo?.updatedAt ?? null,
      canEditInfo,
      canEditPhoto,
    };
  }
  async get(userId: string, orgId: string, target: string) {
    return this.response(await this.scope(userId, orgId, target));
  }
  async update(
    userId: string,
    orgId: string,
    target: string,
    info: ProfessionalInfo,
  ) {
    const access = await this.scope(userId, orgId, target);
    if (!access.canEditInfo)
      throw new ForbiddenException(
        "Only HR or a team manager can edit professional information",
      );
    await this.db.membership.update({
      where: { orgId_id: { orgId, id: target } },
      data: info,
    });
    return this.get(userId, orgId, target);
  }
  async photo(userId: string, orgId: string, target: string) {
    await this.scope(userId, orgId, target);
    const photo = await this.db.employeePhoto.findFirst({
      where: { orgId, membershipId: target },
    });
    return {
      dataUrl: photo
        ? `data:image/jpeg;base64,${Buffer.from(photo.image).toString("base64")}`
        : null,
    };
  }
  async setPhoto(userId: string, orgId: string, target: string, raw: unknown) {
    const access = await this.scope(userId, orgId, target);
    if (!access.canEditPhoto)
      throw new ForbiddenException("You may only change your own photo");
    if (
      typeof raw !== "string" ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        raw,
      ) ||
      raw.length > 180000
    )
      throw new BadRequestException("Choose a JPEG, PNG or WebP photo");
    const bytes = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
    let image: Buffer;
    try {
      const decoder = sharp(bytes, {
        limitInputPixels: 16000000,
        animated: false,
        failOn: "warning",
      });
      const meta = await decoder.metadata();
      if (
        !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
        (meta.pages ?? 1) > 1
      )
        throw new Error("Unsupported photo");
      image = await decoder
        .rotate()
        .resize(384, 384, { fit: "cover", position: "centre" })
        .flatten({ background: "#edf5f4" })
        .jpeg({ quality: 82 })
        .toBuffer();
      if (image.length > 100000) throw new Error("Photo too large");
    } catch {
      throw new BadRequestException(
        "This photo could not be read. Choose a different image",
      );
    }
    await this.db.employeePhoto.upsert({
      where: { membershipId: target },
      create: { membershipId: target, orgId, image: new Uint8Array(image) },
      update: { image: new Uint8Array(image) },
    });
    return this.get(userId, orgId, target);
  }
  async removePhoto(userId: string, orgId: string, target: string) {
    const access = await this.scope(userId, orgId, target);
    if (!access.canEditPhoto)
      throw new ForbiddenException("You may only change your own photo");
    await this.db.employeePhoto.deleteMany({
      where: { orgId, membershipId: target },
    });
    return this.get(userId, orgId, target);
  }
}

@Controller("organizations/:orgId/employees/:membershipId")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Get("profile")
  get(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("membershipId") id: string,
  ) {
    return this.profiles.get(req.actor.userId, input.uuid(org), input.uuid(id));
  }
  @Patch("profile")
  update(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("membershipId") id: string,
    @Body() raw: unknown,
  ) {
    const body = input.body(raw, [...professionalFields]);
    if (!Object.keys(body).length)
      throw new BadRequestException("Choose a field to update");
    const info: ProfessionalInfo = {};
    for (const key of professionalFields) {
      if (body[key] === undefined) continue;
      if (body[key] === null) {
        info[key] = null;
        continue;
      }
      const text = input.text(
        body[key],
        key,
        key === "workEmail" ? 254 : key === "workPhone" ? 50 : 120,
      );
      if (/[\u0000-\u001f\u007f]/.test(text))
        throw new BadRequestException("Invalid profile text");
      info[key] = key === "workEmail" ? input.email(text) : text;
    }
    return this.profiles.update(
      req.actor.userId,
      input.uuid(org),
      input.uuid(id),
      info,
    );
  }
  @Get("photo")
  photo(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("membershipId") id: string,
  ) {
    return this.profiles.photo(
      req.actor.userId,
      input.uuid(org),
      input.uuid(id),
    );
  }
  @Patch("photo")
  setPhoto(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("membershipId") id: string,
    @Body() raw: unknown,
  ) {
    const value = input.body(raw, ["dataUrl"]);
    return this.profiles.setPhoto(
      req.actor.userId,
      input.uuid(org),
      input.uuid(id),
      value.dataUrl,
    );
  }
  @Delete("photo")
  removePhoto(
    @Req() req: AuthRequest,
    @Param("orgId") org: string,
    @Param("membershipId") id: string,
  ) {
    return this.profiles.removePhoto(
      req.actor.userId,
      input.uuid(org),
      input.uuid(id),
    );
  }
}

@Controller("organizations/:orgId/employees")
@UseGuards(AuthGuard)
export class PeopleController {
  constructor(private readonly profiles: ProfileService) {}
  @Get()
  list(@Req() req: AuthRequest, @Param("orgId") org: string) {
    return this.profiles.list(req.actor.userId, input.uuid(org));
  }
}
