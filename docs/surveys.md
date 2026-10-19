# Survey and feedback API

This slice collects evidence. It records normalized participation credit but does not calculate chemistry/skill scores, convert credit to company points or send notifications. An opt-in automatic scheduler runs with the API. Frontend design and behaviour will be developed with the product owner later.

All routes require the existing bearer session and are prefixed with `/organizations/:orgId`. Company and assignment ownership are checked server-side.

## Survey length and answers

New periodic and milestone surveys contain exactly **five rating questions about one colleague**. The standard composition is three skill questions plus two chemistry questions: one enjoyment and one effectiveness. Four skill questions plus a single chemistry question is also accepted. That single chemistry question may cover either dimension. Unknown/unspecified question categories cannot be used in a new five-question survey.

The design target is **120 seconds per survey**, with no written answers. It is not a countdown, session expiry, or a rule that rejects someone who takes longer. Actual completion time will need user testing once the frontend exists. Two assigned colleagues mean two separate surveys, with a target of up to four minutes for the batch.

Owner/HR can retain manual selection of five approved question IDs or enable [adaptive question selection](question-selection.md). Adaptive mode chooses a separate 3+2 set for each assignment using observed and pending coverage. Manual selection also supports 4+1; thresholds for automatically switching composition remain undefined.

Already-issued surveys retain their exact question count and wording, including older shorter surveys and longer milestones. They must be answered in their original form and keep their existing participation rules. Migration 8 pauses older automatic policies whose selected set is not five questions, preserves their selected IDs, and requires explicit owner/HR reconfiguration and opt-in. `GET /feedback-policy` reports `requiresQuestionSetUpdate` for a non-empty current set of the old size.

## Schedule and assignment rules

The default is one colleague per employee, weekly. Company owner/HR can select weekly, fortnightly or calendar-monthly generation, one or two colleagues, local day/time, timezone and a question set. Automation is disabled until enabled explicitly. See [automatic scheduling](scheduling.md) for settings and timing examples.

Periodic surveys have no expiry. Either unresolved survey blocks the employee's entire next batch; finishing mid-cycle waits until the next scheduled generation. Missed cycles are discarded. Shared active teams establish eligibility at generation time; overlapping memberships do not multiply requests. An issued request retains its work context and can be answered after that team ends while company memberships remain active.

The manual generation route uses the same durable cycle receipt and outstanding-work gate as the worker. Repeated calls do not top up a batch or issue new work mid-cycle. The cycle's question selection/order stays fixed. Employees can request a replacement or skip through the [participation API](participation.md); actual interaction confirmation beyond self-reporting is not implemented.

Milestone generation is available to the assigned team manager or owner/HR. It uses explicitly selected employees with overlapping participation history in that team. It can run after a team ends, so end-of-project feedback remains possible. Each selected employee reviews up to the current policy's colleague cap; these milestone requests are additional to periodic requests. Each successful milestone POST creates a new survey, so retrying a successful POST intentionally creates another survey. Client idempotency keys are not supported yet.

## Endpoints

| Method | Suffix | Access / purpose |
| --- | --- | --- |
| GET | `/feedback-policy` | Active member; current/pending schedule |
| PATCH | `/feedback-policy` | Owner/HR; configure schedule |
| GET | `/skills` | Active member; skill definitions |
| POST | `/skills` | Owner/HR; create a skill |
| GET | `/questions` | Approved questions and own drafts/rejections; owner/HR see the whole company library |
| POST | `/questions` | Owner/HR/active manager/team leader; propose a new draft version |
| GET | `/questions/standard-library` | Active member; view the 21 standard templates |
| POST | `/questions/import-standard` | HR only; import and approve the standard library |
| POST | `/questions/:questionId/review` | HR only; approve or reject a draft |
| POST | `/surveys/generate-periodic` | Owner/HR; manual five IDs or `{}` under an adaptive policy; shared outstanding-work gate and one generation per cycle |
| POST | `/teams/:teamId/surveys/milestone` | Owner/HR/assigned manager; 2–30 selected employees; omit question IDs for adaptive selection, supply five for manual |
| GET | `/assignments/my-open` | Own actionable assignments only |
| GET | `/assignments/:assignmentId` | Assigned respondent only; wording and context, no submitted answers |
| POST | `/assignments/:assignmentId/submit` | Assigned respondent only; validate and submit all answers atomically |

Managers and administrators cannot use the assignment routes to inspect someone else's responses. There is no raw-answer listing endpoint. Skill weights are question configuration, not exposed employee scores.

## Example request sequence

Use the organization and team IDs created through the company API. Replace the placeholder IDs with actual returned IDs; no production credentials are included here.

1. Create a skill with `POST /skills`:

```json
{"name":"Communication"}
```

2. Create a question with `POST /questions`. A skill mapping is optional, allowing collaboration questions without interpreting them as skill ratings:

```json
{
  "questionKey":"communication",
  "text":"How clearly did this colleague communicate during your work together?",
  "skillWeights":[{"skillId":"<skill-id>","weight":1}]
}
```

This creates a DRAFT, which cannot be assigned yet. Posting the same question key creates a new numbered draft and preserves the old version and its review. An HR administrator must call `POST /questions/:questionId/review` with `{"decision":"APPROVED"}` before the version can enter any survey or automatic question set. A rejection uses `{"decision":"REJECTED","note":"Please clarify the wording."}`. See [question approval and standard templates](questions.md). Distinct positive weights must sum to one and have at most four decimal places. There is no five-skill limit. Definitions can currently be created/listed, but there are no editing, deletion or activation endpoints.

3. Optionally configure a different cadence with `PATCH /feedback-policy`:

```json
{"frequency":"FORTNIGHTLY","colleaguesPerPeriod":2}
```

Before issuing a new survey, create/approve the other two skill questions and adopt or create/approve the two chemistry questions. All five IDs must be distinct.

4. Issue this cycle's requests with `POST /surveys/generate-periodic`:

```json
{"questionVersionIds":["<skill-question-1>","<skill-question-2>","<skill-question-3>","<enjoyment-question>","<effectiveness-question>"]}
```

The response reports the period, counts of created surveys and assignments, and the number of employees with fewer peers than configured. An empty/isolated team is not an error; its employees receive no unsupported requests.

For a milestone, instead use `POST /teams/:teamId/surveys/milestone`:

```json
{
  "questionVersionIds":["<skill-question-1>","<skill-question-2>","<skill-question-3>","<enjoyment-question>","<effectiveness-question>"],
  "participantMembershipIds":["<alice-membership-id>","<bob-membership-id>"],
  "closesAt":"<future ISO timestamp with timezone>"
}
```

5. Sign in as an assigned employee and call `GET /assignments/my-open`, then `GET /assignments/:assignmentId` for the exact question IDs and wording.

6. Submit with `POST /assignments/:assignmentId/submit`:

```json
{
  "answers":[
    {"questionVersionId":"<skill-question-1>","rating":4},
    {"questionVersionId":"<skill-question-2>","rating":3},
    {"questionVersionId":"<skill-question-3>","rating":4},
    {"questionVersionId":"<enjoyment-question>","rating":5},
    {"questionVersionId":"<effectiveness-question>","rating":null}
  ]
}
```

Every assigned question must have exactly one answer: an integer rating from 1–5, or explicit `"rating":null` for “I haven’t observed this.” Missing the rating field is invalid. Unobserved answers store no numerical rating and must be excluded from future score/confidence calculations; they are never zero or a neutral score. A fully answered survey, including one consisting entirely of unobserved answers, earns the normal 100% completion credit. Unknown questions, duplicate answers and incomplete submissions return 400 without saving partial answers. Wrong respondent/company returns 404. An expired dated milestone or an already closed assignment returns 409. A successful response contains `ok` and `submittedAt`. Completion also records 100% participation credit. Actual point values remain company-defined and are not implemented yet.

Assignment detail includes each question’s `dimension` and `notObservedRating: null`. It also includes `surveyFormat` with the assignment’s actual question count, the 120-second target, and `writtenAnswers: false`. A 3+2 survey includes both chemistry dimensions; a 4+1 survey includes only one. All answers concern the same assigned colleague. See [chemistry questions](questions.md#pairwise-chemistry-questions).

Submitted answers are immutable. Issued question versions, skill mappings, survey composition, deadlines and team context are protected against historical rewrites. A new version is required for a different question or mapping. Periodic assignments remain actionable without expiry after team participation ends; dated milestone assignments remain actionable until their explicit deadline. Active company membership is required.

## Verification

`npm run test:api` builds and runs all HTTP suites in disposable databases. The survey suite covers defaults, custom periods and colleague caps, overlapping teams, concurrent generation/submission, company isolation, assignment privacy, question history, invalid answers, milestones, closed surveys and ended participation. Existing authentication and database suites remain part of `npm test`.
