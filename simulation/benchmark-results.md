# Synthetic reviewer-calibration comparison

Twenty seeds per scenario, starting at 17026. Five fictional employees, five skills; 16 weeks with two five-question surveys per respondent/week, except the sparse three-week scenario. Errors are mean absolute deviations from the known current synthetic skill, on a 0–100 scale. Lower is better. Truth labels are never passed to scoring functions.

| Scenario | Recency only | Current model | Adjustment + recency | Adjustment + current |
| --- | ---: | ---: | ---: | ---: |
| Different skills, no systematic reviewer bias | 2.71 | 2.73 | 2.70 | 2.72 |
| Harsh and generous reviewers | 4.03 | 4.97 | 2.64 | 2.67 |
| Friendship and dislike specific to each pair | 6.26 | 8.87 | 7.95 | 12.01 |
| Reviewer tendencies plus pair effects | 8.42 | 12.00 | 7.50 | 11.22 |
| Relationship impressions overwhelm skill ratings | 15.31 | 17.40 | 16.34 | 20.92 |
| Real technical improvement | 5.04 | 5.97 | 3.95 | 4.05 |
| Real technical deterioration | 5.43 | 6.58 | 3.91 | 4.16 |
| Occasional extreme answers | 2.91 | 2.69 | 2.96 | 2.74 |
| Everyone uses a harsher scale | 19.89 | 19.89 | 19.84 | 19.83 |
| Sparse and overlapping evidence | 7.90 | 7.90 | 7.90 | 7.90 |

Reviewer adjustment is capped at 0.5 stars and shrunk toward zero. It requires eight matched units across three other colleagues and excludes the current colleague and all chemistry. This is a relative reviewer estimate, not a determination of bias or motive.

These results include failures: pair-specific bias can be made worse, relationship-dominated answers can lose skill information, and bias shared by every reviewer remains unidentifiable without an external anchor. The old outlier rule also introduces delay on some genuine changes. No winning formula is declared or adopted. See simulation/README.md and the interactive lab for employee examples, coverage, spread and change detection.
