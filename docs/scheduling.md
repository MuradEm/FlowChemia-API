# Automatic feedback scheduling

Company owners and independent HR configure automatic generation through `PATCH /organizations/:orgId/feedback-policy`. It is disabled until explicitly enabled with a valid question set. Team managers and team leaders cannot change company-wide timing.

```json
{
  "frequency":"WEEKLY",
  "colleaguesPerPeriod":2,
  "weekday":1,
  "generationTime":"09:00",
  "timeZone":"Europe/Berlin",
  "questionVersionIds":["<skill-question-1>","<skill-question-2>","<skill-question-3>","<enjoyment-question>","<effectiveness-question>"],
  "automaticEnabled":true
}
```

## Settings

| Field | Values / meaning |
| --- | --- |
| `frequency` | `WEEKLY`, `FORTNIGHTLY`, `MONTHLY` |
| `colleaguesPerPeriod` | One or two separate colleague assignments per generation |
| `weekday` | ISO weekday 1 (Monday) through 7 (Sunday), for weekly/fortnightly schedules |
| `monthDay` | Day 1–31 for monthly schedules; clamped to that month's last day |
| `generationTime` | Local `HH:mm`, 24-hour clock |
| `timeZone` | IANA timezone such as `Europe/Berlin`; UTC by default |
| `questionSelection` | `MANUAL` (existing default) or `ADAPTIVE`; adaptive chooses from the approved company library |
| `questionVersionIds` | In manual mode, exactly five approved active versions: 3 skills + 2 chemistry, or 4 skills + 1 chemistry; omit in adaptive mode |
| `automaticEnabled` | Explicit company opt-in; false pauses immediately |

PATCH accepts partial changes. The initial default is weekly, Monday 09:00 UTC, one colleague, with automation disabled. `periodDays` is a deprecated compatibility input accepting only 7, 14 or 30, mapped to the three presets. It no longer permits arbitrary intervals. Its retained storage value does not define monthly duration: monthly means a calendar month.

Weekly/fortnightly events retain the configured local weekday and clock time through daylight-saving changes. Fortnightly timing has a persisted date anchor so it does not drift into weekly timing. Monthly events retain the selected month day rather than adding 30 days. Day 31 becomes February 28/29 when needed and returns to March 31. A nonexistent local time during a DST gap moves forward through the gap; a repeated local time uses its earlier occurrence, once.

Enabling automation schedules a future boundary; it does not immediately generate a historic batch. Changes during an issued cycle take effect at its next boundary. Existing requests and question versions stay intact. Pausing takes effect immediately; re-enabling starts with a future scheduled slot.

`GET /organizations/:orgId/feedback-policy` returns the active policy, current calendar window, any pending policy, next generation timestamp and last generation record. Its window end is the next generation boundary, not an assignment expiry.

## Outstanding batches and availability

Periodic assignments have no expiry (`closesAt: null`). A request remains available until completed, voluntarily skipped, or closed after no replacement is possible. Its original work context and wording remain even when its original team ends or the employee moves to another team. Company membership must remain active. A request concerning an inactive colleague stays visible with `requiresReplacement: true` and can be replaced; no suitable alternative closes as insufficient opportunity, with reward treatment still undecided.

If either of a person's one or two requests remains unresolved, the next automatic generation issues **no new batch** to that employee. Completing only one of two is insufficient. Replacement transfers the existing slot and continues blocking until its final outcome; it does not add a third slot. An open manager-triggered request can also block a new batch while it remains actionable.

Resolving outstanding work does not trigger immediate generation. The employee waits until the next automatic slot. Missed cycles are discarded, not accumulated as a debt or backlog. The generation worker records even a cycle that produced no assignments because everyone was blocked or lacked eligible colleagues.

For example, Alice receives two requests on January 4, clears one and leaves the other open. January 11 issues her nothing. She finishes January 13 and waits until January 18. No immediate replacement batch is issued on January 13, and the missed January 11 requests are not added later.

Existing periodic deadlines are archived in `legacyClosesAt` and removed during migration. Periodic requests issued before the upgrade also remain available. Manager-triggered milestone surveys retain their explicit deadline API; expired legacy/milestone requests do not block a person forever. The indefinite-availability rule here applies to recurring periodic surveys.

## Worker and retries

`npm start` starts the internal scheduler after the HTTP server starts. It checks once at startup and every 60 seconds; events are processed on the first tick at/after their scheduled time. The API process must stay running. There is no notification/email delivery in this implementation.

Each company/cycle has a unique durable `SurveyGeneration` record. A company-level transaction lock and unique key prevent duplicate batches when processes overlap or retry. Answers, skips and replacement actions use the same lock, so generation sees a consistent participation state. Each employee's current batch is considered across all their shared teams; overlapping memberships do not multiply requests.

After downtime, only the latest due cycle is considered. Earlier missed boundaries are not replayed. If someone completed after that latest scheduled boundary while the worker was down, they still wait until the next generation instead of receiving an immediate catch-up batch. This is based on persisted outcome times, not only whether the person currently has an open request.

Failure rolls back the entire company generation. The next tick retries, and one failing company does not block other companies. Logs contain a company identifier and a generic failure message, not answers, tokens or query arguments.

The manual `POST /surveys/generate-periodic` route remains available to owner/HR for development/administrative generation. It uses the same outstanding-work gate and durable cycle receipt. Repeating it does not top up a batch, add new joiners mid-cycle, or immediately issue more work after someone finishes. A different question set within an already processed cycle returns 409. When automation is enabled it must match the configured question set.

With [adaptive selection](question-selection.md), send `{}` to this route.
The library is frozen for the generation and each assignment receives its own
five-question subset. Pending requests reserve coverage without becoming
answered evidence. Generation retries retain the original subsets.

## Verification

`npm run test:calendar` checks weekly and fortnightly boundaries, calendar-month end, leap years, timezone anchors and both DST transitions. The scheduler HTTP/integration suite uses an injected internal clock to run several months without waiting or exposing a client-controlled time parameter. It verifies presets/access, opt-in, concurrent generation, persistent unanswered requests, both-survey blocking, team changes, completion timing, missed cycles, pause, monthly generation through DST and failure isolation/retry.

Migration 8 pauses automatic policies with an old question count. Their selected IDs and outstanding requests remain intact. Owner/HR must select an approved five-question set and explicitly enable automation again. `requiresQuestionSetUpdate` identifies a non-empty current selection with the old count. The generation timing, no-backlog rule and outstanding-work gate continue to apply.
