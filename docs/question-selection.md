# Adaptive survey questions

Question selection now runs in the API, independently of the experimental
score formulas. It uses actual observed coverage and pending reservations;
ratings and the 70-point scoring baseline do not affect question selection.

## Enable

Owner/HR first imports the standard library or approves company questions.
Then configure `PATCH /organizations/:orgId/feedback-policy`:

```json
{
  "questionSelection": "ADAPTIVE",
  "automaticEnabled": true,
  "frequency": "WEEKLY",
  "colleaguesPerPeriod": 2
}
```

Omit `questionVersionIds` in adaptive mode. The approved company library is the
candidate pool; the mode clears a previously saved manual selection.
At least three eligible skill questions and one question for each chemistry
dimension must exist. Eligible questions are approved, active rating versions;
skill questions must map only to active skills. The newest eligible version
per question key enters the pool. Drafts, rejected questions, unclassified
questions and other companies' questions are excluded.

Automation still requires explicit opt-in and starts at the next boundary.
Schedule changes after issuance wait until the next cycle; pausing remains
immediate, including when the library is no longer usable. Invalid generation
rolls back so the scheduler can retry after the library is repaired.

For administrative periodic generation, POST `{}` to
`/organizations/:orgId/surveys/generate-periodic` after configuring adaptive
mode. Periodic generation follows the company's active mode. Supplying explicit
IDs while adaptive is active returns 400.

For a milestone, omit `questionVersionIds` to request adaptive selection:

```json
{
  "participantMembershipIds": ["<alice-membership-id>", "<bob-membership-id>"],
  "closesAt": "<future ISO timestamp with timezone>"
}
```

Providing exactly five approved IDs retains manual milestone behavior,
independently of the periodic policy. Existing role and participant restrictions
remain in force.

## Selection behavior

Each assignment receives three skill questions, one enjoyment question and one
effectiveness question about its selected colleague. The manual 4+1 format
remains available; adaptive selection currently uses the default 3+2 format.
There is no automatic threshold for switching formats yet.

- Skills are prioritized by least observed or reserved coverage for the subject,
  across the company's projects and reviewers. Custom question weights spread
  coverage across their mapped skills.
- Chemistry coverage is specific to respondent → subject and dimension.
- Completed, non-null answers contribute coverage. Repeated observations from
  the same reviewer in the same UTC Monday-based calendar week contribute at
  most one coverage unit per skill/dimension. Coverage ages with a 42-day
  half-life from submission time. Null answers contribute none.
- Open, currently actionable assignments for active company members reserve
  their questions. Within a generation, each newly created assignment reserves
  coverage before the next is chosen. Skipped, replaced, unavailable and expired
  assignments are not pending reservations.
- Each chosen question also reserves coverage while the remaining questions
  in its assignment are selected. This favors different skills when available.
  Least-covered wording breaks coverage ties; question key and ID provide
  deterministic final tie-breaks. Reuse remains possible when the pool is small.

These are coverage measures, not statistical confidence or performance scores.
Pending requests never become answers. No answer values or private coworker
feedback are returned to the respondent as selection explanations.

## Persistence and compatibility

Migration 9 adds the selection mode and immutable assignment question IDs.
Existing policies, surveys, receipts and assignments keep manual behavior.
Existing answer values and wording remain unchanged, including shorter legacy
assignments.

An adaptive survey freezes a candidate library snapshot before assignments are
created; each assignment stores its ordered five-question subset. The existing
survey-question foreign keys still anchor answers. The database rejects answers
outside that subset and protects its order and membership from changes.
`GET /assignments/:id` returns only those five questions, in assigned order.
Completion requires all five answers, including explicit nulls when unobserved.

Replacement selects a fresh subset for the replacement colleague from the
original frozen pool, restricted to questions still eligible. It releases the
old pending reservation in the same transaction. Failure to select a valid
replacement set rolls back the replacement; the original request stays open.
Cross-team replacements retain the original pool and work context rules.

The company transaction lock serializes generation with submissions, skips,
replacements and question approval. One durable periodic receipt per cycle
prevents duplicate assignments. Retrying a processed adaptive generation returns
the receipt without re-evaluating the current library or rewriting questions.
Milestone retries still create new surveys as documented in the survey API.

The current implementation reads company history into memory for selection.
Large histories will need incremental coverage aggregates and query batching
before large-company rollout; there are no performance claims from this change.

## Verification

`npm run test:api` includes allocator tests and disposable-database HTTP tests
for coverage aging, pending reservations, directional chemistry, weighted custom
questions, approval/tenant boundaries, concurrency, frozen history, private
five-question detail, submission validation, replacement, milestones, scheduling,
pause and unchanged participation rules. The migration test also verifies legacy
surveys remain answerable after this upgrade.
