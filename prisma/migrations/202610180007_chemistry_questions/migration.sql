BEGIN;
-- CreateEnum
CREATE TYPE "QuestionDimension" AS ENUM ('UNSPECIFIED', 'SKILL', 'CHEMISTRY_ENJOYMENT', 'CHEMISTRY_EFFECTIVENESS');

-- AlterTable
ALTER TABLE "QuestionVersion" ADD COLUMN     "dimension" "QuestionDimension" NOT NULL DEFAULT 'UNSPECIFIED';


-- Classify only explicit historical skill mappings. Do not guess what old
-- unmapped questions measure, or rewrite their wording, reviews, or answers.
UPDATE "QuestionVersion" q SET dimension='SKILL'
WHERE EXISTS (SELECT 1 FROM "QuestionSkill" w WHERE w."orgId"=q."orgId" AND w."questionVersionId"=q.id);

CREATE FUNCTION freeze_question_dimension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dimension IS DISTINCT FROM OLD.dimension THEN
    RAISE EXCEPTION 'Create a new question version to change its dimension' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_question_dimension BEFORE UPDATE ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION freeze_question_dimension();

CREATE FUNCTION require_skill_question_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "QuestionVersion" WHERE id=NEW."questionVersionId" AND "orgId"=NEW."orgId" AND dimension='SKILL') THEN
    RAISE EXCEPTION 'Only skill questions can carry skill mappings' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_skill_question_mapping BEFORE INSERT OR UPDATE ON "QuestionSkill" FOR EACH ROW EXECUTE FUNCTION require_skill_question_mapping();
COMMIT;
