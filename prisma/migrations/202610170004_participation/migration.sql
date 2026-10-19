BEGIN;

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('OPEN', 'COMPLETED', 'SKIPPED', 'REPLACED', 'NO_REPLACEMENT');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "replacesAssignmentId" UUID,
ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "ParticipationCredit" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "rootAssignmentId" UUID NOT NULL,
    "outcome" "AssignmentStatus" NOT NULL,
    "percentage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipationCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationCredit_assignmentId_key" ON "ParticipationCredit"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationCredit_rootAssignmentId_key" ON "ParticipationCredit"("rootAssignmentId");

-- CreateIndex
CREATE INDEX "ParticipationCredit_orgId_membershipId_createdAt_idx" ON "ParticipationCredit"("orgId", "membershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationCredit_orgId_assignmentId_key" ON "ParticipationCredit"("orgId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationCredit_orgId_rootAssignmentId_key" ON "ParticipationCredit"("orgId", "rootAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_replacesAssignmentId_key" ON "Assignment"("replacesAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_orgId_replacesAssignmentId_key" ON "Assignment"("orgId", "replacesAssignmentId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_orgId_replacesAssignmentId_fkey" FOREIGN KEY ("orgId", "replacesAssignmentId") REFERENCES "Assignment"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ParticipationCredit" ADD CONSTRAINT "ParticipationCredit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationCredit" ADD CONSTRAINT "ParticipationCredit_orgId_membershipId_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "Membership"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ParticipationCredit" ADD CONSTRAINT "ParticipationCredit_orgId_assignmentId_fkey" FOREIGN KEY ("orgId", "assignmentId") REFERENCES "Assignment"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ParticipationCredit" ADD CONSTRAINT "ParticipationCredit_orgId_rootAssignmentId_fkey" FOREIGN KEY ("orgId", "rootAssignmentId") REFERENCES "Assignment"("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve previously submitted feedback while introducing explicit outcomes.
DROP TRIGGER protect_submission ON "Assignment";
UPDATE "Assignment" SET status='COMPLETED', "closedAt"="submittedAt" WHERE "submittedAt" IS NOT NULL;
ALTER TABLE "Assignment" ADD CONSTRAINT "assignment_outcome_dates" CHECK (
  (status='OPEN' AND "submittedAt" IS NULL AND "closedAt" IS NULL) OR
  (status='COMPLETED' AND "submittedAt" IS NOT NULL AND "closedAt"="submittedAt") OR
  (status IN ('SKIPPED','REPLACED','NO_REPLACEMENT') AND "submittedAt" IS NULL AND "closedAt" IS NOT NULL)
);
ALTER TABLE "ParticipationCredit" ADD CONSTRAINT "participation_percentages" CHECK (
  (outcome='COMPLETED' AND percentage=100) OR (outcome='SKIPPED' AND percentage=60)
);

CREATE OR REPLACE FUNCTION protect_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR OLD."submittedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Closed assignments are immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.id,NEW."orgId",NEW."teamId",NEW."surveyId",NEW."respondentTeamMemberId",NEW."subjectTeamMemberId",NEW."replacesAssignmentId",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."orgId",OLD."teamId",OLD."surveyId",OLD."respondentTeamMemberId",OLD."subjectTeamMemberId",OLD."replacesAssignmentId",OLD."createdAt") THEN
    RAISE EXCEPTION 'Assignment identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."submittedAt" IS NOT NULL THEN
    IF NEW.status NOT IN ('OPEN','COMPLETED') THEN RAISE EXCEPTION 'Conflicting outcome' USING ERRCODE='23514'; END IF;
    NEW.status := 'COMPLETED';
    NEW."closedAt" := NEW."submittedAt";
    IF (SELECT count(*) FROM "Answer" WHERE "assignmentId"=NEW.id)=0 OR
       (SELECT count(*) FROM "Answer" WHERE "assignmentId"=NEW.id)<>(SELECT count(*) FROM "SurveyQuestion" WHERE "surveyId"=NEW."surveyId") THEN
      RAISE EXCEPTION 'All questions must be answered' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.status IN ('SKIPPED','REPLACED','NO_REPLACEMENT') AND EXISTS (SELECT 1 FROM "Answer" WHERE "assignmentId"=NEW.id) THEN
    RAISE EXCEPTION 'Non-completion cannot contain answers' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_submission BEFORE UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION protect_submission();

CREATE OR REPLACE FUNCTION protect_submitted_answers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_id UUID;
BEGIN
  IF TG_OP='DELETE' THEN assignment_id:=OLD."assignmentId"; ELSE assignment_id:=NEW."assignmentId"; END IF;
  IF (SELECT status <> 'OPEN' FROM "Assignment" WHERE id=assignment_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Closed assignments cannot accept answer changes' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD."assignmentId"<>NEW."assignmentId" THEN
    RAISE EXCEPTION 'Answers cannot move between assignments' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE FUNCTION validate_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "Assignment"%ROWTYPE;
DECLARE old_survey "Survey"%ROWTYPE;
DECLARE new_survey "Survey"%ROWTYPE;
BEGIN
  IF NEW.status<>'OPEN' OR NEW."submittedAt" IS NOT NULL OR NEW."closedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'New assignments must be open' USING ERRCODE='23514';
  END IF;
  IF NEW."replacesAssignmentId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO parent FROM "Assignment" WHERE id=NEW."replacesAssignmentId" AND "orgId"=NEW."orgId" FOR UPDATE;
  IF NOT FOUND OR parent.status<>'REPLACED' THEN RAISE EXCEPTION 'Invalid replacement parent' USING ERRCODE='23514'; END IF;
  IF (SELECT "membershipId" FROM "TeamMember" WHERE id=parent."respondentTeamMemberId") IS DISTINCT FROM
     (SELECT "membershipId" FROM "TeamMember" WHERE id=NEW."respondentTeamMemberId") THEN
    RAISE EXCEPTION 'Replacement must belong to the same respondent' USING ERRCODE='23514';
  END IF;
  SELECT * INTO old_survey FROM "Survey" WHERE id=parent."surveyId";
  SELECT * INTO new_survey FROM "Survey" WHERE id=NEW."surveyId";
  IF (old_survey.kind,old_survey."opensAt",old_survey."closesAt") IS DISTINCT FROM
     (new_survey.kind,new_survey."opensAt",new_survey."closesAt") OR
     (old_survey.kind='MILESTONE' AND parent."surveyId"<>NEW."surveyId") OR
     (SELECT array_agg("questionVersionId" ORDER BY position) FROM "SurveyQuestion" WHERE "surveyId"=parent."surveyId") IS DISTINCT FROM
     (SELECT array_agg("questionVersionId" ORDER BY position) FROM "SurveyQuestion" WHERE "surveyId"=NEW."surveyId") THEN
    RAISE EXCEPTION 'Replacement must preserve survey context' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_replacement BEFORE INSERT ON "Assignment" FOR EACH ROW EXECUTE FUNCTION validate_replacement();

CREATE FUNCTION validate_participation_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terminal "Assignment"%ROWTYPE;
DECLARE cursor_id UUID;
DECLARE parent_id UUID;
DECLARE depth INTEGER:=0;
BEGIN
  SELECT * INTO terminal FROM "Assignment" WHERE id=NEW."assignmentId" AND "orgId"=NEW."orgId";
  IF NOT FOUND OR terminal.status<>NEW.outcome OR terminal.status NOT IN ('COMPLETED','SKIPPED') OR
    (SELECT "membershipId" FROM "TeamMember" WHERE id=terminal."respondentTeamMemberId") IS DISTINCT FROM NEW."membershipId" THEN
    RAISE EXCEPTION 'Credit must match a terminal outcome and respondent' USING ERRCODE='23514';
  END IF;
  cursor_id:=terminal.id;
  LOOP
    SELECT "replacesAssignmentId" INTO parent_id FROM "Assignment" WHERE id=cursor_id AND "orgId"=NEW."orgId";
    IF NOT FOUND OR depth>10000 THEN RAISE EXCEPTION 'Invalid replacement history' USING ERRCODE='23514'; END IF;
    EXIT WHEN parent_id IS NULL;
    cursor_id:=parent_id; depth:=depth+1;
  END LOOP;
  IF cursor_id<>NEW."rootAssignmentId" THEN RAISE EXCEPTION 'Credit root does not match history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_participation_credit BEFORE INSERT ON "ParticipationCredit" FOR EACH ROW EXECUTE FUNCTION validate_participation_credit();

CREATE FUNCTION immutable_participation_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Participation credits are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER immutable_participation_credit BEFORE UPDATE OR DELETE ON "ParticipationCredit" FOR EACH ROW EXECUTE FUNCTION immutable_participation_credit();
COMMIT;
