# Isolated and repeated technical feedback

Original seed 17026; Alice, Technical Problem Solving. Reviewer calibration is off. Compare the same 42-day recency weights, with or without the current outlier rule. Primary cases use one survey per week for eight rounds. Context cases use four surveys/week, one per colleague. Each survey has five answers; only technical is rated, and the other four are explicitly unobserved.

| Pattern | Starting score | After eight: recency only | After eight: outlier rule | Unusual reports / distinct reviewers |
| --- | ---: | ---: | ---: | ---: |
| Low: Usual feedback continues | 91.27 | 90.51 | 90.51 | 0 / 0 |
| Low: One unusual report, then usual feedback | 91.27 | 85.63 | 88.88 | 1 / 1 |
| Low: Repeated unusual reports from Carla | 91.27 | 35.92 | 12.74 | 8 / 1 |
| Low: Repeated unusual reports from three colleagues | 91.27 | 35.92 | 12.74 | 8 / 3 |
| Low: Carla differs; three peers continue usual feedback | 91.27 | 70.83 | 70.83 | 8 / 1 |
| Low: Three colleagues change; one continues usual feedback | 91.27 | 32.10 | 32.10 | 24 / 3 |
| High (mirrored): Usual feedback continues | 8.73 | 9.49 | 9.49 | 0 / 0 |
| High (mirrored): One unusual report, then usual feedback | 8.73 | 14.37 | 11.12 | 1 / 1 |
| High (mirrored): Repeated unusual reports from Carla | 8.73 | 64.08 | 87.26 | 8 / 1 |
| High (mirrored): Repeated unusual reports from three colleagues | 8.73 | 64.08 | 87.26 | 8 / 3 |
| High (mirrored): Carla differs; three peers continue usual feedback | 8.73 | 29.17 | 29.17 | 8 / 1 |
| High (mirrored): Three colleagues change; one continues usual feedback | 8.73 | 67.90 | 67.90 | 24 / 3 |

Low cases use Alice's original high technical history (91.27 points). High cases mirror only that history, producing a hypothetical 8.73-point baseline. The saved employee card and completed Carla→Alice survey are preserved.

The Carla-only and rotating-reviewer primary cases have identical dates, rating values and volume; only reviewer identities differ. Both models produce identical trajectories for them. The current rule restores influence after three reviewer-week units even if all three come from Carla. By round eight of sustained low ratings, all sixteen original technical units are discounted as unusual against the new weighted median: 12.74 points versus 35.92 with recency alone. This is a self-reinforcing effect of this candidate formula, not a declaration that Carla is wrong.

Stable skill is assumed for controls, the isolated case and the Carla-only cases. A real change is assumed for multi-reviewer change cases. Those labels are for evaluating false alarms and responsiveness, not inputs to either formula. A single colleague can observe a real change, while several can share a bias; report patterns alone cannot establish which story is true.

The rule limits isolated movement but can amplify persistent reports later. Keep these as experimental alternatives. The interactive lab contains all nine checkpoints, plots, reviewer counts and historical-discount diagnostics. JSON includes all synthetic survey records and assumptions. No production formula was changed.
