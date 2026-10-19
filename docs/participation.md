# Skips, replacements and participation credit

Participation is recorded as a percentage of one survey's company-defined reward. This implementation does not assign a fixed point value, provide a spendable balance, convert historical percentages into points, or configure a reward catalogue. Companies will choose those values when their rewards are defined.

| Outcome | Participation credit |
| --- | --- |
| Completed feedback | 100% |
| Voluntarily skipped assignment | 60% |
| Requested another colleague | None yet; final replacement outcome decides |
| No replacement available | Unresolved; percentage is null, not 0% or 60% |

Ratings never affect participation credit. Skips and replacement requests never insert ratings or modify chemistry/skill summaries.

## Actions and scope

These authenticated routes use the prefix `/organizations/:orgId`:

| Method | Suffix | Body / response |
| --- | --- | --- |
| POST | `/assignments/:assignmentId/skip` | Empty object; closes that assignment slot and records 60% |
| POST | `/assignments/:assignmentId/replace` | Empty object; returns outcome and replacement ID, or `NO_REPLACEMENT` |
| GET | `/participation/my` | Own latest 200 credit entries, with percentage, outcome and terminal assignment ID |

Only the assigned respondent can use these actions, including when the caller is an owner, HR administrator or manager. Clients cannot supply percentages. The API applies the agreed 100% and 60% rules itself.

`skip` applies to one assignment slot. When a company requests two colleagues per period, skipping one does not close the other. A future frontend can group these actions with the product owner's guidance; no screen wording or group-level skip action is fixed here.

Both actions require an open assignment. Periodic requests have no expiry and remain answerable after the original team ends; dated milestones must still be inside their original response window. Replacement can search other eligible teams if the original team or colleague is no longer eligible. Inactive company membership cannot take actions or read participation records.

## Replacement rules

Periodic replacements use another active colleague in any active team shared with the respondent in the same company. They exclude self, independent HR, every colleague already assigned in the same cycle, and every colleague declined earlier in the replacement history. This includes already completed or skipped slots, so replacing cannot recycle a colleague from the other slot.

The original period, question versions, wording and skill mappings are preserved. Periodic requests and their replacements have no expiry; a dated milestone keeps its original deadline. A replacement in another shared team records that new team context while retaining a link to the original assignment. Milestone replacements stay in the manager's originally selected participant group and require overlapping historical participation. They remain possible after that team ends, until the original deadline.

When a replacement exists, the original becomes `REPLACED` and a new `OPEN` assignment is created transactionally. It replaces the same participation slot; it does not add another rewarded slot. Periodic generation counts original slots and separately remembers all previously selected colleagues.

If no eligible candidate remains, the request closes as `NO_REPLACEMENT`. No credit entry is created, because the reward treatment is still undecided. The closed slot is not automatically regenerated in that period. It remains distinguishable from a voluntary skip and can support a future explicit policy decision.

## Outcomes and audit records

Assignment statuses are `OPEN`, `COMPLETED`, `SKIPPED`, `REPLACED` and `NO_REPLACEMENT`. Detail responses include status, close time, replacement ID and participation percentage when awarded. Only `OPEN` actionable assignments appear in `my-open`.

Each linear replacement history can have exactly one participation credit. It links the final completed/skipped assignment to the original slot and employee membership. Percentage entries are immutable. Repeating an action on a closed assignment returns 409. Simultaneous skip/submit and simultaneous replacements serialize, producing one winning outcome rather than duplicate credit or branching replacements.

The credit and closing/submission happen in one transaction: failure cannot leave a closed assignment without its expected new credit. Incomplete or invalid submissions create neither answers nor credit. Historical submissions from before this migration retain their completed status; credit is not retroactively minted.

## Testing

`npm run test:api` includes a dedicated disposable-database participation suite. It verifies privacy, exact 100%/60% outcomes, immutable and non-duplicated credit, no answer creation on skips, original deadlines, no repeated colleagues, cross-team replacement, cycle quotas, milestone scope, exhausted candidates, concurrency and expired/inactive requests.

The [automatic scheduler](scheduling.md) waits until all outstanding requests are resolved and never tops up a batch during the same cycle.
