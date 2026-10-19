-- Derived, rebuildable model diagnostics. Raw answers and historical data stay intact.
ALTER TABLE "SkillInsight" ADD COLUMN "details" JSONB;
ALTER TABLE "PairInsight" ADD COLUMN "details" JSONB;
