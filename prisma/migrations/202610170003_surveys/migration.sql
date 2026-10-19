-- AlterEnum
ALTER TYPE "SurveyKind" ADD VALUE 'PERIODIC';

-- CreateTable
CREATE TABLE "FeedbackPolicy" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 7,
    "colleaguesPerPeriod" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FeedbackPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackPolicy_orgId_effectiveFrom_key" ON "FeedbackPolicy"("orgId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "FeedbackPolicy" ADD CONSTRAINT "FeedbackPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Survey_orgId_teamId_kind_opensAt_key" ON "Survey"("orgId", "teamId", "kind", "opensAt");
ALTER TABLE "FeedbackPolicy" ADD CONSTRAINT "feedback_policy_bounds" CHECK ("periodDays" BETWEEN 1 AND 365 AND "colleaguesPerPeriod" BETWEEN 1 AND 2);

CREATE FUNCTION freeze_survey_questions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "Assignment" WHERE "surveyId" = OLD."surveyId") THEN
    RAISE EXCEPTION 'Assigned survey questions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "Assignment" WHERE "surveyId" = NEW."surveyId") THEN
    RAISE EXCEPTION 'Assigned survey questions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER freeze_survey_questions BEFORE INSERT OR UPDATE OR DELETE ON "SurveyQuestion" FOR EACH ROW EXECUTE FUNCTION freeze_survey_questions();

CREATE FUNCTION freeze_question_skills() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "SurveyQuestion" WHERE "questionVersionId" = OLD."questionVersionId") THEN
    RAISE EXCEPTION 'Used skill mappings are immutable; create a new question version' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "SurveyQuestion" WHERE "questionVersionId" = NEW."questionVersionId") THEN
    RAISE EXCEPTION 'Used skill mappings are immutable; create a new question version' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER freeze_question_skills BEFORE INSERT OR UPDATE OR DELETE ON "QuestionSkill" FOR EACH ROW EXECUTE FUNCTION freeze_question_skills();

CREATE FUNCTION freeze_survey_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Assignment" WHERE "surveyId" = OLD.id) AND
     (NEW."orgId", NEW."teamId", NEW.kind, NEW."opensAt", NEW."closesAt") IS DISTINCT FROM
     (OLD."orgId", OLD."teamId", OLD.kind, OLD."opensAt", OLD."closesAt") THEN
    RAISE EXCEPTION 'Assigned survey context is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_survey_context BEFORE UPDATE ON "Survey" FOR EACH ROW EXECUTE FUNCTION freeze_survey_context();
