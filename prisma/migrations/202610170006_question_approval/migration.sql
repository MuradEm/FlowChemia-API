BEGIN;
-- CreateEnum
CREATE TYPE "QuestionApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuestionApprovalOrigin" AS ENUM ('HR', 'STANDARD', 'LEGACY');

-- AlterTable
ALTER TABLE "Answer" ALTER COLUMN "rating" DROP NOT NULL;

-- AlterTable
ALTER TABLE "QuestionVersion" ADD COLUMN     "approvalOrigin" "QuestionApprovalOrigin",
ADD COLUMN     "approvalStatus" "QuestionApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "createdByMembershipId" UUID,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByMembershipId" UUID,
ADD COLUMN     "standardTemplateKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_orgId_standardTemplateKey_key" ON "QuestionVersion"("orgId", "standardTemplateKey");

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_orgId_createdByMembershipId_fkey" FOREIGN KEY ("orgId", "createdByMembershipId") REFERENCES "Membership"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_orgId_reviewedByMembershipId_fkey" FOREIGN KEY ("orgId", "reviewedByMembershipId") REFERENCES "Membership"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Preserve existing surveys without inventing an HR review that never occurred.
UPDATE "QuestionVersion" SET "approvalStatus"='APPROVED', "approvalOrigin"='LEGACY';
ALTER TABLE "QuestionVersion" ADD CONSTRAINT question_review_metadata CHECK ((
  ("approvalStatus"='DRAFT' AND "approvalOrigin" IS NULL AND "reviewedByMembershipId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL) OR
  ("approvalStatus"='APPROVED' AND "approvalOrigin"='LEGACY' AND "reviewedByMembershipId" IS NULL AND "reviewedAt" IS NULL) OR
  ("approvalStatus" IN ('APPROVED','REJECTED') AND "approvalOrigin" IN ('HR','STANDARD') AND "reviewedByMembershipId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
) IS TRUE);

CREATE FUNCTION protect_question_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW."orgId",NEW.text,NEW.kind,NEW."questionKey",NEW.version,NEW."createdByMembershipId",NEW."createdAt",NEW."standardTemplateKey") IS DISTINCT FROM
       (OLD.id,OLD."orgId",OLD.text,OLD.kind,OLD."questionKey",OLD.version,OLD."createdByMembershipId",OLD."createdAt",OLD."standardTemplateKey") THEN
      RAISE EXCEPTION 'Create a new question version instead of changing its content' USING ERRCODE='23514';
    END IF;
    IF OLD."approvalStatus" <> 'DRAFT' AND
       (NEW."approvalStatus",NEW."approvalOrigin",NEW."reviewedByMembershipId",NEW."reviewedAt",NEW."reviewNote") IS DISTINCT FROM
       (OLD."approvalStatus",OLD."approvalOrigin",OLD."reviewedByMembershipId",OLD."reviewedAt",OLD."reviewNote") THEN
      RAISE EXCEPTION 'Question reviews are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."approvalOrigin" IN ('HR','STANDARD') AND (TG_OP='INSERT' OR OLD."approvalStatus"='DRAFT') THEN
    IF NOT EXISTS (SELECT 1 FROM "Membership" WHERE id=NEW."reviewedByMembershipId" AND "orgId"=NEW."orgId" AND active AND role='HR_ADMIN') THEN
      RAISE EXCEPTION 'An active HR administrator must review questions' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_question_review BEFORE INSERT OR UPDATE ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION protect_question_review();

CREATE OR REPLACE FUNCTION freeze_question_skills() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND (
    EXISTS (SELECT 1 FROM "SurveyQuestion" WHERE "questionVersionId"=OLD."questionVersionId") OR
    EXISTS (SELECT 1 FROM "QuestionVersion" WHERE id=OLD."questionVersionId" AND "approvalStatus"<>'DRAFT')
  ) THEN
    RAISE EXCEPTION 'Reviewed skill mappings are immutable; create a new question version' USING ERRCODE='23514';
  END IF;
  IF TG_OP <> 'DELETE' AND (
    EXISTS (SELECT 1 FROM "SurveyQuestion" WHERE "questionVersionId"=NEW."questionVersionId") OR
    EXISTS (SELECT 1 FROM "QuestionVersion" WHERE id=NEW."questionVersionId" AND "approvalStatus"<>'DRAFT')
  ) THEN
    RAISE EXCEPTION 'Reviewed skill mappings are immutable; create a new question version' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE FUNCTION require_approved_survey_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "QuestionVersion" WHERE id=NEW."questionVersionId" AND "orgId"=NEW."orgId" AND "approvalStatus"='APPROVED') THEN
    RAISE EXCEPTION 'Only approved questions can be assigned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_approved_question BEFORE INSERT OR UPDATE ON "SurveyQuestion" FOR EACH ROW EXECUTE FUNCTION require_approved_survey_question();
COMMIT;
