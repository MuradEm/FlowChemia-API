BEGIN;
ALTER TABLE "FeedbackPolicy" ADD COLUMN "questionSelection" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("questionSelection" IN ('MANUAL','ADAPTIVE'));
ALTER TABLE "SurveyGeneration" ADD COLUMN "questionSelection" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("questionSelection" IN ('MANUAL','ADAPTIVE'));
ALTER TABLE "Survey" ADD COLUMN "questionSelection" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("questionSelection" IN ('MANUAL','ADAPTIVE'));
ALTER TABLE "Assignment" ADD COLUMN "questionVersionIds" UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE "FeedbackPolicy" DROP CONSTRAINT "calendar_policy_bounds";
ALTER TABLE "FeedbackPolicy" ADD CONSTRAINT "calendar_policy_bounds" CHECK (
 weekday BETWEEN 1 AND 7 AND "monthDay" BETWEEN 1 AND 31 AND "generationHour" BETWEEN 0 AND 23 AND "generationMinute" BETWEEN 0 AND 59 AND
 cardinality("questionVersionIds") BETWEEN 0 AND 5 AND
 (NOT "automaticEnabled" OR (("questionSelection"='ADAPTIVE' OR cardinality("questionVersionIds")=5) AND "automaticStartsAt" IS NOT NULL))
);
ALTER TABLE "SurveyGeneration" DROP CONSTRAINT "generation_bounds";
ALTER TABLE "SurveyGeneration" ADD CONSTRAINT "generation_bounds" CHECK (
 (("questionSelection"='ADAPTIVE' AND cardinality("questionVersionIds")=0) OR ("questionSelection"='MANUAL' AND cardinality("questionVersionIds") BETWEEN 1 AND 5)) AND
 "createdAssignments">=0 AND "blockedEmployees">=0 AND "employeesWithLimitedPeers">=0
);
CREATE OR REPLACE FUNCTION protect_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR OLD."submittedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Closed assignments are immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.id,NEW."orgId",NEW."teamId",NEW."surveyId",NEW."respondentTeamMemberId",NEW."subjectTeamMemberId",NEW."replacesAssignmentId",NEW."createdAt",NEW."questionVersionIds") IS DISTINCT FROM
     (OLD.id,OLD."orgId",OLD."teamId",OLD."surveyId",OLD."respondentTeamMemberId",OLD."subjectTeamMemberId",OLD."replacesAssignmentId",OLD."createdAt",OLD."questionVersionIds") THEN
    RAISE EXCEPTION 'Assignment identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."submittedAt" IS NOT NULL THEN
    IF NEW.status NOT IN ('OPEN','COMPLETED') THEN RAISE EXCEPTION 'Conflicting outcome' USING ERRCODE='23514'; END IF;
    NEW.status := 'COMPLETED';
    NEW."closedAt" := NEW."submittedAt";
    IF (SELECT count(*) FROM "Answer" WHERE "assignmentId"=NEW.id)=0 OR
       (SELECT count(*) FROM "Answer" WHERE "assignmentId"=NEW.id)<>(CASE WHEN cardinality(NEW."questionVersionIds")>0 THEN cardinality(NEW."questionVersionIds") ELSE (SELECT count(*) FROM "SurveyQuestion" WHERE "surveyId"=NEW."surveyId") END) THEN
      RAISE EXCEPTION 'All questions must be answered' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.status IN ('SKIPPED','REPLACED','NO_REPLACEMENT') AND EXISTS (SELECT 1 FROM "Answer" WHERE "assignmentId"=NEW.id) THEN
    RAISE EXCEPTION 'Non-completion cannot contain answers' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_assignment_questions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode TEXT;
BEGIN
 SELECT "questionSelection" INTO mode FROM "Survey" WHERE id=NEW."surveyId" AND "orgId"=NEW."orgId";
 IF mode='MANUAL' AND cardinality(NEW."questionVersionIds")<>0 THEN
   RAISE EXCEPTION 'Manual assignments use survey questions' USING ERRCODE='23514';
 END IF;
 IF mode='ADAPTIVE' AND (cardinality(NEW."questionVersionIds")<>5 OR
    (SELECT count(*) FROM "SurveyQuestion" WHERE "orgId"=NEW."orgId" AND "surveyId"=NEW."surveyId" AND "questionVersionId"=ANY(NEW."questionVersionIds"))<>5) THEN
   RAISE EXCEPTION 'Adaptive assignments need five distinct questions from the frozen pool' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_assignment_questions BEFORE INSERT ON "Assignment" FOR EACH ROW EXECUTE FUNCTION validate_assignment_questions();
CREATE FUNCTION require_assigned_answer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids UUID[];
BEGIN
 SELECT "questionVersionIds" INTO ids FROM "Assignment" WHERE id=NEW."assignmentId" AND "orgId"=NEW."orgId";
 IF cardinality(ids)>0 AND NOT NEW."questionVersionId"=ANY(ids) THEN
   RAISE EXCEPTION 'Question was not assigned' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER require_assigned_answer BEFORE INSERT OR UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION require_assigned_answer();
CREATE FUNCTION freeze_survey_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."questionSelection"<>OLD."questionSelection" THEN
   RAISE EXCEPTION 'Survey selection mode is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_survey_selection BEFORE UPDATE ON "Survey" FOR EACH ROW EXECUTE FUNCTION freeze_survey_selection();
COMMIT;
