BEGIN;

-- CreateEnum
CREATE TYPE "FeedbackFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "FeedbackPolicy" ADD COLUMN     "anchorDate" TEXT,
ADD COLUMN     "automaticEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "automaticStartsAt" TIMESTAMP(3),
ADD COLUMN     "frequency" "FeedbackFrequency" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "generationHour" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "generationMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "questionVersionIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "weekday" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "generationId" UUID,
ADD COLUMN     "legacyClosesAt" TIMESTAMP(3),
ALTER COLUMN "closesAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SurveyGeneration" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionVersionIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "createdAssignments" INTEGER NOT NULL DEFAULT 0,
    "blockedEmployees" INTEGER NOT NULL DEFAULT 0,
    "employeesWithLimitedPeers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SurveyGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurveyGeneration_orgId_id_key" ON "SurveyGeneration"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyGeneration_orgId_scheduledFor_key" ON "SurveyGeneration"("orgId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackPolicy_orgId_id_key" ON "FeedbackPolicy"("orgId", "id");

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_orgId_generationId_fkey" FOREIGN KEY ("orgId", "generationId") REFERENCES "SurveyGeneration"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SurveyGeneration" ADD CONSTRAINT "SurveyGeneration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyGeneration" ADD CONSTRAINT "SurveyGeneration_orgId_policyId_fkey" FOREIGN KEY ("orgId", "policyId") REFERENCES "FeedbackPolicy"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

UPDATE "FeedbackPolicy" SET frequency=CASE WHEN "periodDays"=14 THEN 'FORTNIGHTLY'::"FeedbackFrequency" WHEN "periodDays" IN (30,31) THEN 'MONTHLY'::"FeedbackFrequency" ELSE 'WEEKLY'::"FeedbackFrequency" END;
-- New periodic assignments have no expiry. Preserve former deadlines as history.
DROP TRIGGER freeze_survey_context ON "Survey";
UPDATE "Survey" SET "legacyClosesAt"="closesAt", "closesAt"=NULL WHERE kind IN ('PERIODIC','WEEKLY');
CREATE OR REPLACE FUNCTION freeze_survey_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Assignment" WHERE "surveyId" = OLD.id) AND
     (NEW."orgId",NEW."teamId",NEW.kind,NEW."opensAt",NEW."closesAt",NEW."legacyClosesAt",NEW."generationId") IS DISTINCT FROM
     (OLD."orgId",OLD."teamId",OLD.kind,OLD."opensAt",OLD."closesAt",OLD."legacyClosesAt",OLD."generationId") THEN
    RAISE EXCEPTION 'Assigned survey context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_survey_context BEFORE UPDATE ON "Survey" FOR EACH ROW EXECUTE FUNCTION freeze_survey_context();
ALTER TABLE "FeedbackPolicy" ADD CONSTRAINT "calendar_policy_bounds" CHECK (
  weekday BETWEEN 1 AND 7 AND "monthDay" BETWEEN 1 AND 31 AND
  "generationHour" BETWEEN 0 AND 23 AND "generationMinute" BETWEEN 0 AND 59 AND
  cardinality("questionVersionIds") BETWEEN 0 AND 2 AND
  (NOT "automaticEnabled" OR (cardinality("questionVersionIds") BETWEEN 1 AND 2 AND "automaticStartsAt" IS NOT NULL))
);
ALTER TABLE "SurveyGeneration" ADD CONSTRAINT "generation_bounds" CHECK (
  cardinality("questionVersionIds") BETWEEN 1 AND 2 AND "createdAssignments">=0 AND
  "blockedEmployees">=0 AND "employeesWithLimitedPeers">=0
);
COMMIT;
