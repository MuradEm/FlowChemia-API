# Employee cards and team relationships

`GET /organizations/:orgId/teams/:teamId/insights` returns the current roster
and permitted skill indicators. Add `?focus=<membership UUID>` for connections
involving that employee only. An unfocused request returns **no relationships**.
The focused employee must be a current, active member of this team. Dates are
ISO timestamps; responses are private/no-store. The endpoint never serializes
raw answers, exact scores, confidence percentages, reviewer identities or emails.

## Visibility

- Independent HR: team skill summaries and both directions for team pairs.
  Active HR participation or a team role anywhere in the company rejects insight
  access, even if inconsistent data was inserted outside the application.
- Assigned manager or current participating team leader: team skill summaries
  and both directions between other employees. For pairs involving the viewer,
  return only the viewer's own reported enjoyment/effectiveness; the incoming
  direction and combined result are null and marked `OWN_EXPERIENCE`.
- Ordinary current participant: their own skill summaries, team roster, and their
  own reported direction for pairs involving themselves. Other pairs are omitted.
- Owner without a team role: roster only; skill summaries are null, relationships
  absent, and the frontend hides employee-insight actions. Ownership grants no
  automatic feedback access. An owner can explicitly assign team roles through
  company setup, with the same personal-relationship restrictions as anyone else.
- Other users, inactive memberships, and foreign-company team IDs cannot access
  the team. Grant/revocation and current participation are checked on each call.

`mode` is `TEAM`, `PERSONAL` or `ROSTER`. Employee skills and pair fields are
allow-listed projections, not persistence objects hidden later in the browser.
A pair's `combined` indicator means **reported collaboration effectiveness**,
not friendship, happiness, or verified productivity. Enjoyment stays separate.

## Calculation and saved summaries

Migration 10 adds nullable JSON `details` to SkillInsight and PairInsight.
Numerical scores stay in these existing company-scoped model-versioned tables;
details retain directional enjoyment/effectiveness estimates and real evidence
metadata. Existing answers and summaries are preserved. No database reset.

Model `baseline-70-v1` implements the accepted starting calculation:

- Stars map to 30, 50, 65, 80 and 100 points.
- Each skill/directional metric starts at 70 with five units of prior weight,
  aged from its first actual observation. The prior is never five real reviews.
- Completed, non-null answers contribute using historical question skill mappings.
  A question can affect multiple skills using its configured weights. Chemistry
  uses its explicit dimension, never a skill mapping or another direction.
- Average each author's observations about one subject/metric within a Monday
  UTC week, weighted by the question's skill links. Cap total unit weight at one;
  partial skill weights below one remain partial. This prevents repeated questions
  or same-week surveys from manufacturing unlimited independent evidence.
- Exponential recency uses a 42-day half-life, including the prior. It remains a
  candidate parameter, not proof of measurement accuracy. There is no hard cutoff,
  reviewer calibration, friendship discount or outlier suppression in this version.
- Combined effectiveness is the equal mean of the two directional effectiveness
  estimates **only when both directions have actual observed feedback**.
- Past company projects contribute; changing teams never resets an employee or
  pair. No feedback crosses company boundaries. Historical/inactive question
  versions still contribute to observed history; inactive skills aren't displayed.

Completing a survey recalculates the subject's active skill summaries and that
pair's two dimensions/directions from their full completed history, inside the
same company lock and transaction as answers and participation credit. Failure
to save summaries rolls back completion rather than leaving stale summaries.
Null answers supply no observations. Skips, replacements and survey generation
never add score evidence or recalculate scores.

Card reads reuse saved summaries. A missing current-version summary, including
feedback collected before this feature existed, is calculated on first access.
There is no periodic rebuild worker. When the formula changes, bump the model
version: next completion recomputes its affected summaries with the new formula;
a missing summary can also be filled by a card request. Other employees' stored
summaries aren't rewritten just because one person completes a survey. Raw
answers remain available for future recalculation. Card `computedAt` is the
response's evaluation time; persistence records keep their own calculation time.

## First visual interpretation

These conservative presentation rules are a first version for review, not
calibrated confidence or a validated evaluation of employee ability:

- No actual observations: `UNKNOWN` / Not observed, neutral line.
- Latest observation older than 126 days: `OLDER` / Older feedback, neutral.
- Skills with fewer than five reviewer-week units or fewer than two distinct
  colleagues: `EARLY` / Early feedback, neutral.
- Each relationship direction needs at least three observed weekly units before
  a coloured interpretation. Combined effectiveness requires that level in both
  directions; its evidence count is the minimum weekly units per direction.
- Otherwise: at least 80 positive; 65–under-80 mixed; under 65 may need support /
  difficult experience. Colours always have text/icons. Baseline-only values never
  produce positive lines. No overall employee score or employee ranking is added.

Responses show actual weekly observation/reviewer counts and first/last evidence
information separately. These counts aren't a confidence percentage. Persisted
legacy `confidence` stays zero because no confidence model has been validated.
The frontend shows only permitted qualitative indicators, never the internal
numerical estimates or tooltips containing them.

## Verification

`npm test` includes numerical model checks and real HTTP/database tests for
missing evidence, atomic persistence/rollback, historical continuity, both
chemistry dimensions, own-pair restrictions, role revocation and company scope.
The migration regression tests preserve older one-question surveys and answers.
Browser verification used a disposable database and real API/Vite proxy: overview
with zero lines, focused-only connections, keyboard activation, private manager
views, owner roster-only actions, team switching, no browser storage, axe AA and
320/390/768/1024/1440 widths.
