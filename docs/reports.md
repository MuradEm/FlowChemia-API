# Completion overview API

Completion reports show how issued feedback requests are progressing. They contain aggregate operational counts, not employee performance scores, feedback, or participation credit. No database migration is required for this slice.

## Routes and access

Both routes require a bearer session:

| Method | Path | Access |
| --- | --- | --- |
| GET | `/organizations/:orgId/reports/completion` | Active company owner or independent HR administrator |
| GET | `/organizations/:orgId/teams/:teamId/reports/completion` | Owner/HR, assigned manager, or assigned team leader who still participates in that team |

An ordinary employee cannot read reports even if they can see the team roster. A manager or team leader cannot use their team role to see other teams or company-wide totals. Role and membership changes are checked on each request. Inaccessible organizations/teams return 404; an active member attempting an unauthorized operation returns 403.

The personal relationship restrictions for future chemistry views are not relevant to these counts: reports contain no pair information or individual results. An administrator's report access does not grant access to someone else's assignment or answers.

## Date and type filters

Optional query parameters:

| Parameter | Meaning |
| --- | --- |
| `from` | Inclusive original assignment issuance timestamp, ISO with timezone |
| `to` | Exclusive original assignment issuance timestamp, ISO with timezone |
| `kind` | `ALL` (default), `PERIODIC`, or `MILESTONE` |

Supply both dates or neither. The default is the last 30 days. An explicit window must be positive and at most 366 days. Unknown, repeated, or invalid parameters return 400. `PERIODIC` also includes legacy `WEEKLY` records.

Example suffixes:

```text
/reports/completion
/teams/<team-id>/reports/completion?kind=PERIODIC
/reports/completion?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&kind=MILESTONE
```

These dates select requests by their **original issuance**, not by the date someone submitted a response. The result shows those requests' current state at the returned `asOf` snapshot. A later replacement or completion is included even when it happens after the selected `to` timestamp. This is not a historical “state as of to” report or a count of activity performed during the window.

## Counts

Each original assignment slot counts once. The report follows its linear replacement history to the final assignment. Replaced intermediate rows do not inflate the denominator or appear as additional pending/completed requests.

| Field | Definition |
| --- | --- |
| `issuedSlots` | Original issued slots in the selected cohort |
| `completed` | Final assignment was completed |
| `skipped` | Final assignment was voluntarily skipped |
| `insufficientOpportunity` | Replacement search ended with no suitable colleague; reward treatment remains undecided |
| `pending` | Open and currently actionable |
| `scheduled` | Open, eligible, and its response window has not started |
| `expired` | Still open, but its deadline has passed |
| `unavailable` | Still open and not expired, but a company membership has become inactive |
| `completionRate` | Completed divided by all issued slots, rounded to four decimal places; null when no slots exist |

The seven outcome counts sum to issued slots. A voluntary skip earns 60% participation credit under the separate rewards rule, but does not count as completed feedback. The denominator includes insufficient opportunity, scheduled, expired and unavailable requests; use their separate counts when interpreting the completion rate.

Completed, skipped and insufficient-opportunity outcomes remain final when memberships later change. For dated legacy/milestone requests, expiration takes precedence over unavailable membership. Periodic requests have no expiry and remain pending after the original team ends while company memberships remain active.

## Team attribution and output

A replacement can collect evidence in a different shared team. The operational completion slot remains attributed to the original issuing team; the feedback evidence retains the actual replacement team context. This avoids counting the same request twice or moving an already-issued reporting cohort between teams.

Responses contain `from`, `to`, `asOf`, `kind`, overall `totals`, and `teams`. Each team entry contains its ID, name, counts and completion rate. Company reports list teams with issued slots in the selected window. An explicit authorized team report returns a zero-count entry even when nothing was issued.

No employee or colleague identities, assignment IDs, question text, ratings, credit percentages, or per-person breakdowns are returned. The query never reads answers or participation credits. Reports are computed in a single database snapshot and do not update assignment statuses, awards or feedback.

## Verification

The report HTTP suite uses a disposable company/database. It checks all outcome buckets, linear and cross-team replacement accounting, source issuance dates, later completion, kind filters, zero-count cohorts, role and tenant boundaries, revoked access, aggregate-only response shape, and read-only behaviour. `npm test` also runs the existing authentication, survey, participation and database checks.
