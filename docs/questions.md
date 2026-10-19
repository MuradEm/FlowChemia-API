# Question library and HR review

Routes require bearer authentication and use `/organizations/:orgId` as their prefix. Company questions are private to that company. Standard templates are copied into the company library only when HR explicitly imports them.

## Standard library

`GET /questions/standard-library` exposes library version 2: 15 skill questions (three each for Technical Problem Solving, Communication, Teamwork, Leadership and Reliability) and six chemistry questions (three each for enjoyment and effectiveness). Wording lives in [standard-questions.ts](../src/standard-questions.ts). Interpret every question in the context “During your recent work together.” Use a 1–5 rating or “I haven’t observed this.”

An HR administrator calls `POST /questions/import-standard` with `{}` to adopt all 21 questions. This action records that HR administrator's approval with origin `STANDARD`. It creates the five company skills when absent, reuses exact-name matches, and maps each skill question 100% to its skill category. Chemistry questions have no skill weights and do not create extra skills. Cross-skill weights for these templates have not been decided. Companies can propose their own version with different wording or mappings for fresh HR review.

Import is transactional and repeatable, including concurrent requests. The response contains `libraryVersion`, `createdQuestions`, and a template-key/question-ID mapping. Repeating an import does not duplicate questions, rewrite reviews, or restore earlier wording over company revisions. An inactive matched skill prevents a new import and rolls back the entire operation; already-imported templates are left untouched. Import does not enable scheduling or select questions for the company.

Template keys contain a library version. A future wording or mapping change needs a new template version, preserving existing imports and answers. Technical specialties such as PLC Programming or Commissioning are not automatically inferred from these behavioural questions.

## Company drafts

`POST /questions` accepts:

```json
{
  "questionKey": "technical-explanation",
  "text": "How clearly did this colleague explain a technical problem and help others resolve it?",
  "skillWeights": [
    {"skillId": "<communication-id>", "weight": 0.6},
    {"skillId": "<technical-problem-solving-id>", "weight": 0.4}
  ]
}
```

The 60/40 example demonstrates configuration, not a required weighting. Distinct positive weights must sum to one, with at most four decimal places. Linked skills must be active and belong to the company. Set `dimension` to `SKILL`, `CHEMISTRY_ENJOYMENT`, `CHEMISTRY_EFFECTIVENESS` or `UNSPECIFIED`. If omitted, it defaults to `SKILL` when weights are present and `UNSPECIFIED` otherwise, preserving older clients. Explicit skill questions require at least one skill mapping. Chemistry and unspecified questions cannot carry skill weights. A dimension change requires a new version and fresh HR approval.

An active company owner, HR administrator, assigned manager, or participating team leader can propose a draft. Manager/leader access must concern a team currently running; an ordinary employee cannot create questions. The owner retains configuration access but cannot act as the HR approver. HR can author drafts and must explicitly review them too; self-review by HR is permitted.

Every POST creates a new numbered version with `approvalStatus: DRAFT` and the author membership ID. There is no in-place wording/mapping editing route. To revise a draft or a reviewed question, post the same question key with its new wording and complete mappings. Earlier versions remain intact. An approved version remains usable while a replacement is pending; approving a newer version does not retire older versions or alter an already-selected schedule.

`GET /questions` returns approved versions to all active members. Authors additionally see their own drafts and rejections. Owner/HR see all company versions, including review notes, author, reviewer, decision time and approval origin.

## HR decisions

Only an active `HR_ADMIN` company membership can call `POST /questions/:questionId/review`:

```json
{"decision": "APPROVED", "note": "Suitable for recent shared work."}
```

Or reject with `{"decision":"REJECTED","note":"Please clarify the wording."}`. The note is optional, up to 1,000 characters. A decision records its reviewer and timestamp. Approval verifies that linked skills are still active and weights still sum to one. Rejection does not require those skills to remain active.

A version can be reviewed only once; another decision returns 409. Concurrent reviews serialize with company question creation and survey generation. Reviewed wording, mappings and decision metadata cannot be rewritten. A rejected version cannot enter surveys; propose another version instead. All selection paths enforce approval: manual periodic generation, milestone generation, and automatic schedule configuration/generation. A database trigger also rejects unapproved survey-question links.

Migration 6 preserves all pre-existing versions as `APPROVED` with origin `LEGACY`, without inventing an HR reviewer or decision timestamp. Their existing assignments, answers and mappings remain usable and immutable. Newly created company versions default to `DRAFT`.

## Unobserved responses

Submit `{"questionVersionId":"<assigned-question-id>","rating":null}` for an unobserved behaviour. Null is explicit and means no rating; omitting the field is invalid. Answer every assigned question once. A completed survey earns 100% participation even if all answers are unobserved. It closes the outstanding slot normally; it does not act as a skipped survey or create a replacement. Stored ratings remain immutable after submission.

Future skill and chemistry calculations must omit null ratings from numeric evidence, counts, and confidence. No score calculation is implemented in this change. SQL `count(rating)` and `avg(rating)` naturally exclude nulls; `count(*)` counts answer records and is not a rated-evidence count.

## Verification

`npm run test:api` includes question-library integration tests for author/reviewer permissions, tenant isolation, draft exclusion, approval races, historical versions, repeat and failed imports, explicit-null responses, credit and revoked access. The upgrade-preservation test applies migration 6 over existing feedback and verifies legacy metadata, original ratings and a retained unobserved response.

## Pairwise chemistry questions

Every question refers to recent work together and is answered from the respondent's perspective. Higher 1–5 ratings mean a better experience. Explicit null means “I haven’t observed this / not enough experience.”

| Dimension | Standard question |
| --- | --- |
| Enjoyment | How comfortable did you feel working with this colleague? |
| Enjoyment | How positive was your experience of working with this colleague? |
| Enjoyment | How willing would you be to work closely with this colleague again? |
| Effectiveness | How effectively did you and this colleague work together to complete shared tasks? |
| Effectiveness | How well did you and this colleague coordinate your work? |
| Effectiveness | How effectively did you and this colleague resolve difficulties together? |

New surveys contain exactly five questions. The standard format is three skill questions plus one enjoyment and one effectiveness question. An alternative uses four skill questions plus one chemistry question, covering either enjoyment or effectiveness. Other counts and compositions return 400 on new periodic/milestone generation and question-set configuration. Historical surveys remain answerable in their original form. See [survey format](surveys.md#survey-length-and-answers).

The three alternatives per dimension are available for company selection. The current scheduler keeps its explicitly configured question IDs; it does not automatically rotate questions or alternate chemistry and skill surveys. The company can change its selection for a following cycle using the existing schedule rules. No live company settings are changed by adding templates.

Enjoyment and effectiveness stay separate from skills and from one another. Alice's report about working with Bob is separate from Bob's report about working with Alice. Positive collaboration reports do not prove delivery results. This change stores categorized evidence, without inventing a combined chemistry score, baseline, decay rule, or frontend interpretation.

Migration 7 classifies existing questions with explicit skill mappings as `SKILL`; unmapped questions remain `UNSPECIFIED`. It preserves wording, answers, HR decisions and IDs. Existing version-1 standard template keys remain stable. HR importing version 2 into a company that already adopted all 15 skill questions adds only the six chemistry questions, then subsequent imports create nothing. Database triggers freeze question dimensions and prevent linking chemistry questions to skills.

The five-question format targets two minutes of rating-only answers. Neither this target nor a slow response expires an issued survey. Automatic prioritisation by evidence confidence is not implemented yet; selections remain explicit company configuration.
