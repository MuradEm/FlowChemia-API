import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Database } from './database.js';
import { SurveyService } from './surveys.js';
import { Clock } from './clock.js';

@Injectable()
export class SurveyScheduler implements OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(SurveyScheduler.name);

  constructor(private readonly db: Database, private readonly surveys: SurveyService, private readonly clock: Clock) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runDue(); }, 60000);
    this.timer.unref();
    void this.runDue();
  }

  async runDue() {
    if (this.running) return {processedCompanies: 0, generationsCreated: 0, failures: 0};
    this.running = true;
    let processedCompanies = 0, generationsCreated = 0, failures = 0;
    try {
      const now = this.clock.now();
      const companies = await this.db.$queryRaw<{orgId: string}[]>`
        SELECT "orgId" FROM (
          SELECT DISTINCT ON ("orgId") "orgId", "automaticEnabled", "automaticStartsAt"
          FROM "FeedbackPolicy" WHERE "effectiveFrom" <= ${now}::timestamp
          ORDER BY "orgId", "effectiveFrom" DESC
        ) current_policy WHERE "automaticEnabled" AND "automaticStartsAt" <= ${now}::timestamp
      `;
      for (const company of companies) {
        try {
          const result = await this.surveys.generateAutomatic(company.orgId);
          processedCompanies++;
          if (result && !result.alreadyProcessed) generationsCreated++;
        } catch {
          // Avoid logging request data, tokens, query parameters or ORM errors.
          failures++;
          this.logger.error(`Survey generation failed for company ${company.orgId}; retry on the next tick`);
        }
      }
    } catch {
      failures++;
      this.logger.error('Unable to check survey schedules; retry on the next tick');
    } finally {
      this.running = false;
    }
    return {processedCompanies, generationsCreated, failures};
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
