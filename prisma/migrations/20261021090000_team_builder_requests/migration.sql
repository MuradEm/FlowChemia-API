CREATE TABLE "TeamBuildRequest" (
  "orgId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamBuildRequest_pkey" PRIMARY KEY ("orgId", "requestId"),
  CONSTRAINT "TeamBuildRequest_team_fkey" FOREIGN KEY ("orgId", "teamId") REFERENCES "Team"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
