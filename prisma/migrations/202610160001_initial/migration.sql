-- Initial database foundation. Additional integrity rules follow the generated structure.

CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'HR_ADMIN', 'EMPLOYEE');

CREATE TYPE "TeamRole" AS ENUM ('MANAGER', 'TEAM_LEADER');

CREATE TYPE "QuestionKind" AS ENUM ('RATING');

CREATE TYPE "SurveyKind" AS ENUM ('WEEKLY', 'MILESTONE');

CREATE TABLE "Organization" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

CREATE TABLE "Membership" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'EMPLOYEE',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_orgId_id_key" ON "Membership" ("orgId", "id");

CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership" ("orgId", "userId");

CREATE TABLE "Team" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_orgId_id_key" ON "Team" ("orgId", "id");

CREATE TABLE "TeamMember" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamMember_orgId_id_key" ON "TeamMember" ("orgId", "id");

CREATE UNIQUE INDEX "TeamMember_orgId_teamId_id_key" ON "TeamMember" ("orgId", "teamId", "id");

CREATE INDEX "TeamMember_orgId_membershipId_idx" ON "TeamMember" ("orgId", "membershipId");

CREATE TABLE "TeamAccess" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "role" "TeamRole" NOT NULL,
  CONSTRAINT "TeamAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamAccess_orgId_id_key" ON "TeamAccess" ("orgId", "id");

CREATE UNIQUE INDEX "TeamAccess_orgId_teamId_membershipId_key" ON "TeamAccess" ("orgId", "teamId", "membershipId");

CREATE TABLE "Skill" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Skill_orgId_id_key" ON "Skill" ("orgId", "id");

CREATE UNIQUE INDEX "Skill_orgId_name_key" ON "Skill" ("orgId", "name");

CREATE TABLE "QuestionVersion" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "questionKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "kind" "QuestionKind" NOT NULL DEFAULT 'RATING',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionVersion_orgId_id_key" ON "QuestionVersion" ("orgId", "id");

CREATE UNIQUE INDEX "QuestionVersion_orgId_questionKey_version_key" ON "QuestionVersion" ("orgId", "questionKey", "version");

CREATE TABLE "QuestionSkill" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "skillId" UUID NOT NULL,
  "weight" DECIMAL(5,4) NOT NULL,
  CONSTRAINT "QuestionSkill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionSkill_orgId_id_key" ON "QuestionSkill" ("orgId", "id");

CREATE UNIQUE INDEX "QuestionSkill_orgId_questionVersionId_skillId_key" ON "QuestionSkill" ("orgId", "questionVersionId", "skillId");

CREATE TABLE "Survey" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "kind" "SurveyKind" NOT NULL,
  "opensAt" TIMESTAMP(3) NOT NULL,
  "closesAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Survey_orgId_id_key" ON "Survey" ("orgId", "id");

CREATE UNIQUE INDEX "Survey_orgId_teamId_id_key" ON "Survey" ("orgId", "teamId", "id");

CREATE TABLE "SurveyQuestion" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SurveyQuestion_orgId_id_key" ON "SurveyQuestion" ("orgId", "id");

CREATE UNIQUE INDEX "SurveyQuestion_orgId_surveyId_questionVersionId_key" ON "SurveyQuestion" ("orgId", "surveyId", "questionVersionId");

CREATE UNIQUE INDEX "SurveyQuestion_orgId_surveyId_position_key" ON "SurveyQuestion" ("orgId", "surveyId", "position");

CREATE TABLE "Assignment" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "respondentTeamMemberId" UUID NOT NULL,
  "subjectTeamMemberId" UUID NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Assignment_orgId_id_key" ON "Assignment" ("orgId", "id");

CREATE UNIQUE INDEX "assignment_pair_unique" ON "Assignment" ("orgId", "surveyId", "respondentTeamMemberId", "subjectTeamMemberId");

CREATE UNIQUE INDEX "Assignment_orgId_surveyId_id_key" ON "Assignment" ("orgId", "surveyId", "id");

CREATE TABLE "Answer" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Answer_orgId_id_key" ON "Answer" ("orgId", "id");

CREATE UNIQUE INDEX "Answer_orgId_assignmentId_questionVersionId_key" ON "Answer" ("orgId", "assignmentId", "questionVersionId");

CREATE TABLE "PairInsight" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "firstMembershipId" UUID NOT NULL,
  "secondMembershipId" UUID NOT NULL,
  "combinedScore" DOUBLE PRECISION,
  "firstToSecondScore" DOUBLE PRECISION,
  "secondToFirstScore" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "modelVersion" TEXT NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PairInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PairInsight_orgId_id_key" ON "PairInsight" ("orgId", "id");

CREATE UNIQUE INDEX "pair_model_unique" ON "PairInsight" ("orgId", "firstMembershipId", "secondMembershipId", "modelVersion");

CREATE TABLE "SkillInsight" (
  "id" UUID NOT NULL,
  "orgId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "skillId" UUID NOT NULL,
  "score" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "modelVersion" TEXT NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkillInsight_orgId_id_key" ON "SkillInsight" ("orgId", "id");

CREATE UNIQUE INDEX "SkillInsight_orgId_membershipId_skillId_modelVersion_key" ON "SkillInsight" ("orgId", "membershipId", "skillId", "modelVersion");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Team" ADD CONSTRAINT "Team_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamAccess" ADD CONSTRAINT "TeamAccess_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Skill" ADD CONSTRAINT "Skill_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "QuestionSkill" ADD CONSTRAINT "QuestionSkill_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Survey" ADD CONSTRAINT "Survey_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Answer" ADD CONSTRAINT "Answer_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairInsight" ADD CONSTRAINT "PairInsight_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SkillInsight" ADD CONSTRAINT "SkillInsight_organization_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_user_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_team_fkey" FOREIGN KEY ("orgId", "teamId") REFERENCES "Team" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_membership_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "Membership" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamAccess" ADD CONSTRAINT "TeamAccess_team_fkey" FOREIGN KEY ("orgId", "teamId") REFERENCES "Team" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TeamAccess" ADD CONSTRAINT "TeamAccess_membership_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "Membership" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "QuestionSkill" ADD CONSTRAINT "QuestionSkill_question_fkey" FOREIGN KEY ("orgId", "questionVersionId") REFERENCES "QuestionVersion" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "QuestionSkill" ADD CONSTRAINT "QuestionSkill_skill_fkey" FOREIGN KEY ("orgId", "skillId") REFERENCES "Skill" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Survey" ADD CONSTRAINT "Survey_team_fkey" FOREIGN KEY ("orgId", "teamId") REFERENCES "Team" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_survey_fkey" FOREIGN KEY ("orgId", "surveyId") REFERENCES "Survey" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_question_fkey" FOREIGN KEY ("orgId", "questionVersionId") REFERENCES "QuestionVersion" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_survey_fkey" FOREIGN KEY ("orgId", "teamId", "surveyId") REFERENCES "Survey" ("orgId", "teamId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_respondent_fkey" FOREIGN KEY ("orgId", "teamId", "respondentTeamMemberId") REFERENCES "TeamMember" ("orgId", "teamId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_subject_fkey" FOREIGN KEY ("orgId", "teamId", "subjectTeamMemberId") REFERENCES "TeamMember" ("orgId", "teamId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Answer" ADD CONSTRAINT "Answer_assignment_fkey" FOREIGN KEY ("orgId", "surveyId", "assignmentId") REFERENCES "Assignment" ("orgId", "surveyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Answer" ADD CONSTRAINT "Answer_surveyQuestion_fkey" FOREIGN KEY ("orgId", "surveyId", "questionVersionId") REFERENCES "SurveyQuestion" ("orgId", "surveyId", "questionVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairInsight" ADD CONSTRAINT "PairInsight_first_fkey" FOREIGN KEY ("orgId", "firstMembershipId") REFERENCES "Membership" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairInsight" ADD CONSTRAINT "PairInsight_second_fkey" FOREIGN KEY ("orgId", "secondMembershipId") REFERENCES "Membership" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SkillInsight" ADD CONSTRAINT "SkillInsight_membership_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "Membership" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SkillInsight" ADD CONSTRAINT "SkillInsight_skill_fkey" FOREIGN KEY ("orgId", "skillId") REFERENCES "Skill" ("orgId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- These PostgreSQL rules are intentionally additional to Prisma's model.
ALTER TABLE "Team" ADD CONSTRAINT "team_dates" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "TeamMember" ADD CONSTRAINT "membership_dates" CHECK ("leftAt" IS NULL OR "leftAt" > "joinedAt");
CREATE UNIQUE INDEX "one_open_team_membership" ON "TeamMember" ("orgId", "teamId", "membershipId") WHERE "leftAt" IS NULL;
ALTER TABLE "Survey" ADD CONSTRAINT "survey_dates" CHECK ("closesAt" > "opensAt");
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "positive_question_version" CHECK (version > 0);
ALTER TABLE "QuestionSkill" ADD CONSTRAINT "skill_weight_range" CHECK (weight > 0 AND weight <= 1);
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "positive_position" CHECK (position > 0);
ALTER TABLE "Answer" ADD CONSTRAINT "rating_range" CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "PairInsight" ADD CONSTRAINT "canonical_pair" CHECK ("firstMembershipId" < "secondMembershipId");
ALTER TABLE "PairInsight" ADD CONSTRAINT "pair_confidence" CHECK (confidence BETWEEN 0 AND 1 AND "observationCount" >= 0);
ALTER TABLE "SkillInsight" ADD CONSTRAINT "skill_confidence" CHECK (confidence BETWEEN 0 AND 1 AND "observationCount" >= 0);

CREATE FUNCTION prevent_self_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "membershipId" FROM "TeamMember" WHERE id = NEW."respondentTeamMemberId") =
     (SELECT "membershipId" FROM "TeamMember" WHERE id = NEW."subjectTeamMemberId") THEN
    RAISE EXCEPTION 'Self feedback is not supported' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER no_self_feedback BEFORE INSERT OR UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION prevent_self_feedback();

CREATE FUNCTION protect_submitted_answers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN assignment_id := OLD."assignmentId";
  ELSE assignment_id := NEW."assignmentId"; END IF;
  -- Lock the assignment so submission and answer writes serialize.
  IF (SELECT "submittedAt" IS NOT NULL FROM "Assignment" WHERE id = assignment_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Submitted answers are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."assignmentId" <> NEW."assignmentId" THEN
    RAISE EXCEPTION 'Answers cannot move between assignments' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER protect_answers BEFORE INSERT OR UPDATE OR DELETE ON "Answer" FOR EACH ROW EXECUTE FUNCTION protect_submitted_answers();

CREATE FUNCTION protect_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."submittedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted assignments are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."submittedAt" IS NOT NULL AND (
    (SELECT count(*) FROM "Answer" WHERE "assignmentId" = NEW.id) = 0 OR
    (SELECT count(*) FROM "Answer" WHERE "assignmentId" = NEW.id) <>
    (SELECT count(*) FROM "SurveyQuestion" WHERE "surveyId" = NEW."surveyId")
  ) THEN
    RAISE EXCEPTION 'All survey questions must be answered before submission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_submission BEFORE UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION protect_submission();

CREATE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SurveyQuestion" WHERE "questionVersionId" = OLD.id) AND
     (NEW.text, NEW.kind, NEW."questionKey", NEW.version) IS DISTINCT FROM
     (OLD.text, OLD.kind, OLD."questionKey", OLD.version) THEN
    RAISE EXCEPTION 'Create a new question version instead of editing survey history' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_question_version BEFORE UPDATE ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION protect_question_version();
