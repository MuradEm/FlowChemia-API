BEGIN;
-- Retain selected IDs and all issued work. HR/owner must explicitly select
-- the new five-question format before re-enabling an older schedule.
UPDATE "FeedbackPolicy" SET "automaticEnabled"=false,"automaticStartsAt"=NULL
WHERE "automaticEnabled" AND cardinality("questionVersionIds")<>5;
ALTER TABLE "FeedbackPolicy" DROP CONSTRAINT "calendar_policy_bounds";
ALTER TABLE "FeedbackPolicy" ADD CONSTRAINT "calendar_policy_bounds" CHECK (
  weekday BETWEEN 1 AND 7 AND "monthDay" BETWEEN 1 AND 31 AND
  "generationHour" BETWEEN 0 AND 23 AND "generationMinute" BETWEEN 0 AND 59 AND
  cardinality("questionVersionIds") BETWEEN 0 AND 5 AND
  (NOT "automaticEnabled" OR (cardinality("questionVersionIds")=5 AND "automaticStartsAt" IS NOT NULL))
);
-- Legacy receipts remain immutable history. Newly generated receipts contain five IDs.
ALTER TABLE "SurveyGeneration" DROP CONSTRAINT "generation_bounds";
ALTER TABLE "SurveyGeneration" ADD CONSTRAINT "generation_bounds" CHECK (
  cardinality("questionVersionIds") BETWEEN 1 AND 5 AND "createdAssignments">=0 AND
  "blockedEmployees">=0 AND "employeesWithLimitedPeers">=0
);
COMMIT;
