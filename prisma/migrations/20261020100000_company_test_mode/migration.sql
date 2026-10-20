-- Normal batches retain period uniqueness under a fixed NORMAL discriminator.
-- Test requests use their UUID as discriminator, allowing repeated batches
-- without altering any existing survey, assignment, answer or receipt.
ALTER TABLE "Organization" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Survey" ADD COLUMN "testRunId" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "SurveyGeneration" ADD COLUMN "testRunId" TEXT NOT NULL DEFAULT 'NORMAL';
DROP INDEX "Survey_orgId_teamId_kind_opensAt_key";
CREATE UNIQUE INDEX "Survey_orgId_teamId_kind_opensAt_testRunId_key" ON "Survey"("orgId","teamId","kind","opensAt","testRunId");
DROP INDEX "SurveyGeneration_orgId_scheduledFor_key";
CREATE UNIQUE INDEX "SurveyGeneration_orgId_scheduledFor_testRunId_key" ON "SurveyGeneration"("orgId","scheduledFor","testRunId");
CREATE INDEX "SurveyGeneration_orgId_testRunId_idx" ON "SurveyGeneration"("orgId","testRunId");
