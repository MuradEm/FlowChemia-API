# Current scoring decision

Accepted after the completed 30-survey fresh-team experiment. This is the
current product direction; production scoring is not implemented yet.

- Map stars to points: 1 = 30, 2 = 50, 3 = 65, 4 = 80, 5 = 100.
- Start each employee skill and each directional enjoyment/effectiveness
  estimate with a 70-point baseline having the weight of five reports.
  This is calculation weight, never five actual reviews or reviewers.
- Retain every actual answer. Early impressions contribute immediately but
  do not establish an employee's whole reputation.
- Keep newer evidence more influential. The current experimental half-life
  is 42 days, including aging the baseline from the start of the estimate.
  This parameter remains a candidate for validation.
- Preserve employee/company skill history and pairwise relationship history
  across projects. Joining a new team does not reset an established estimate.
- Show limited evidence separately from the estimate, including distinct real
  reviewers and time covered. Baseline weight supplies no evidence or confidence.
- An unobserved relationship stays visibly unobserved, even if the internal
  calculation has a baseline. Do not display a positive connection merely
  because the baseline exists.
- Keep enjoyment and effectiveness directional. The experimental combined
  effectiveness is the equal average of the two directional estimates; show
  it only when both directions have actual effectiveness observations.
- Reviewer calibration and outlier suppression remain experimental and are
  excluded from the accepted comparison calculation.

Three stars means 65, below the initial baseline of 70. Repeated three-star
answers therefore gradually lower an estimate; survey labels should make the
meaning of the response scale clear. Numerical estimates are internal product
data; the intended application presents visual summaries with evidence context.

## Reproduce the comparison

Run `node simulation/recalculate-fresh-team.mjs`. It reads the original session
without changing its answers and writes
`simulation/sessions/fresh-team-001-prior-comparison.json`.
The original exercise and its original formulas remain available for comparison.

The 30-survey exercise demonstrates behavior, not real-world fairness or
accuracy. Next validation should check sustained changes, isolated extreme
answers, and repeated feedback from one person versus several reviewers.
