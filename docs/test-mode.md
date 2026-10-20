# Company test mode

Company test mode permits extra **manual** batches in the same calendar period.
It is off by default and stored on Organization, so it survives API restarts.
Owner and HR can toggle it in Survey settings. Team managers/leaders and ordinary
employees cannot change it or generate company batches. No environment-wide or
cross-company bypass is introduced.

## API

All routes are authenticated and company-scoped under `/organizations/:orgId`.

- `PATCH /test-mode` with `{"enabled":true}` or `{"enabled":false}` changes the
  setting immediately, returning `{"testMode":true}` (or false). It does not
  edit current/pending feedback policies, enable automation or delete anything.
- `POST /surveys/generate-test` with `{"requestId":"<UUID>"}` generates a manual
  test batch only while mode is enabled. A missing/invalid request ID is 400;
  new test requests with mode off are 409. Only owner/HR may call either route.
- Reusing a request UUID in the same company returns its existing receipt with
  `alreadyProcessed:true` and zero newly created assignments, including retries
  in another period or after mode has been switched off. It cannot mint another
  batch after employees have completed the original. Use a new UUID for each
  deliberate extra batch. The company lock serializes requests and submissions.
- `GET /feedback-policy` additionally returns `testMode`,
  `currentPeriodProcessed` (normal generation only), and `lastGeneration.isTest`.
  The last generation is the latest processed receipt, including test receipts;
  next automatic generation is calculated from normal receipts only.
- `GET /organizations/:orgId` includes `testMode` for active company members.
  Assignment summaries/details and participation entries carry `isTest` so
  their origin remains visible after the flag is disabled. Team insight views
  include the current company flag for their banner.

## Rules that stay in place

Test generation uses the active company's policy: one or two distinct colleagues,
active memberships and current active teams, independent HR exclusion, approved
questions, five-question surveys, adaptive coverage/pending reservations, normal
participation and score calculation. It considers colleagues across overlapping
teams without multiplying the configured per-batch limit.

**Any unresolved actionable survey still blocks that employee**, including
ordinary periodic surveys, milestone requests and test surveys. Finishing only
one of two is insufficient. After all outstanding requests are resolved, another
manual test batch can be generated immediately. Unlike normal generation, test
generation doesn't look back to see whether an employee was blocked at the
calendar-period boundary; the waiting-period rule is what this mode bypasses.

Automatic generation and `POST /surveys/generate-periodic` retain their normal
one-batch-per-period receipts and timing. Test batches never consume that receipt
or advance the automatic scheduler. Pending policy changes still have their
configured effective dates. Disable the flag to restore normal manual UI limits;
normal generation also retains its usual boundary-based outstanding-work rules.

Test surveys are periodic requests with no expiry. Their opening time is the
actual generation time. Replacement stays within the test batch and doesn't
exclude colleagues merely because they appeared in an earlier test batch.

## Data and UI

This is a test mode for the **same company records**, not a separate database or
sandbox dataset. Answers, credits, completion reports and employee/pair insights
update through the ordinary pipeline. The formula and reviewer-week evidence
rules are unchanged. Switching mode off does not delete or exclude test feedback,
reset scores, cancel pending surveys or remove participation credit.

The screen states these effects beside the toggle, shows a company test banner,
labels test generation results and marks test check-ins/credits. Existing test
surveys stay labelled while mode is off. To avoid duplicate creation after an
uncertain response, the browser retains the request UUID in memory until its
result is confirmed. Refresh is required before confirmation; the next explicit
click replays the same request. No automatic mutation retry is added.

## Migration and verification

Migration 11 adds the company flag (default false) and `testRunId` discriminators
on Survey and SurveyGeneration. Existing rows receive `NORMAL`. Composite unique
indexes retain the original uniqueness for normal rows while allowing separate
UUID-identified test batches at the same clock instant/period. Existing surveys,
answers, policies and receipts remain unchanged in meaning. No reset is needed.

`npm test` covers ordinary calendar generation and dedicated mode tests: default
state, owner/HR access, tenant scope, pending-survey blocking, repeat batches,
concurrent/replayed UUIDs, cross-period replay, normal receipt separation,
replacement, saved scoring/credit, turning mode off and automatic idempotency.
The migration regression fixture also applies this migration over legacy surveys.
Browser checks used a disposable PostgreSQL database and actual API/Vite proxy,
including a server-committed/lost response followed by safe confirmation after
completion, role visibility, retained labels, mobile overflow and axe AA.
