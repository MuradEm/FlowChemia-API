# Experimental scoring and question-allocation lab

Open [flowchemia-lab.html](flowchemia-lab.html) in a browser. It is self-contained: no server, external scripts, account, network or live company data is required. Source files are model.mjs, app.mjs and index.template.html. The production API does not import the model. The five-question, rating-only survey format remains unchanged.

Build with `npm run simulate`. Run the thirty model/calibration/pattern/evidence tests with `npm run test:simulation`. Node 24 reads the existing standard-question TypeScript source directly. No package dependency was added. The existing API integration suite was not rerun for this isolated prototype.

## What to try

1. Choose an employee to act as and a different colleague to review.
2. Select three skills and answer the five displayed standard questions, or mark a question unobserved.
3. Compare current, preview and plain recency-weighted points. Apply a survey to retain it within the page.
4. Use “Try a low outlier” for Carla reviewing Alice's technical skills, or “Try a high outlier” for Carla reviewing Bob. The other four answers become unobserved to isolate the experiment.
5. Apply once, then use “Repeat next week” twice to see repeated evidence regain influence.
6. Adjust half-life and unusual-answer influence. These recalculate both the current results and history.
7. Compare the planner with pending reservations enabled/disabled. These never alter scores.
8. Download experiment data to preserve the synthetic answers, applied reports and settings. Reload/reset returns to the seeded team; the page has no persistent storage.

The preset seed is 17026, with Alice, Bob, Carla, Dan and Elias. Twelve weeks × five respondents × two colleagues × five questions = 600 synthetic answers from 120 surveys. Every respondent reviews at most two colleagues per week. Different profiles and bounded noise make the data repeatable. Alice→Bob intentionally combines enjoyment with weaker effectiveness; Bob→Alice has a different experience. The fixture is illustrative, not representative workplace validation.

## Candidate formula v0.1

All parameters below are experimental defaults, not approved production policy.

- Ratings are integer 1–5; explicit null means unobserved. There is no zero-star response. Internal points map `(weighted mean − 1) × 25` to 0–100. Missing evidence produces no score, not a neutral baseline.
- Collapse answers into one averaged unit per respondent, subject, metric and calendar week. This limits repeated same-week answers from one source. For this experiment the weekly grouping matches the seeded schedule; fortnightly/monthly production grouping is not decided.
- Base weight is `2^(−age in days / half-life)`. Default half-life is 42 days; the control supports 14–180 days. This experiment uses gradual decay rather than a hard historical cutoff.
- Compute a recency-weighted median of the units. With at least six units, answers at least 1.5 stars from that median are provisionally unusual, in either direction.
- An unusual answer retains 25% of its otherwise applicable weight, unless at least three units within the latest 42 days are within 0.75 stars of it. Then full weight is restored. No answer is deleted or called false.
- The three units must be distinct reviewer/weeks. They may be three different colleagues or one colleague over three different weeks. This is repeated experience, not independent corroboration. The UI reports distinct colleagues separately. In directional chemistry there is necessarily only one respondent for a given direction.
- Recompute from the available evidence every time. A later recurring change can restore the weight of earlier similar answers still inside the support window. Results can also change when supporting evidence ages. The “without outlier adjustment” comparison uses identical decay and reviewer-week aggregation to isolate this extra rule.
- Skill evidence is aggregated for the subject across colleagues. Chemistry evidence is scoped to respondent→colleague and dimension; Alice's answers do not replace Bob's. The lab's combined **reported effectiveness** is the equal average of both directional effectiveness scores only, and stays absent if either direction lacks evidence. It is not an agreed overall chemistry score. Enjoyment stays separate.

These evidence units and effective weight are diagnostics, not a calibrated confidence percentage. Different skill scales, cross-skill question weights, project context, evaluator bias, survey periodicities and actual outcome validity still require design work before a production formula. In particular, an unusual answer may be accurate or describe a real change; historical agreement cannot establish truth. We should compare candidate settings against abrupt genuine changes, persistent minority experiences and inaccurate positive reports, as well as isolated noise.

### Reproducible preset results

With the default parameters:

| Experiment | Before | One new report | One report without outlier adjustment | Three reports over three weeks |
| --- | ---: | ---: | ---: | ---: |
| Carla rates Alice's technical skill 1 star | 91.27 | 88.52 | 81.19 | 64.28 |
| Carla rates Bob's technical skill 5 stars | 25.59 | 27.72 | 33.43 | 46.78 |

The final column advances the simulated date by 14 days, so it includes recency changes too. These movements are examples to inspect, not proof that the chosen thresholds are fair.

## Pending survey reservations

The allocator ranks skill gaps using recency-weighted completed evidence units plus active reserved question counts. Each pending question provisionally counts as one coverage unit; it contributes zero score evidence. It chooses three different skill categories, then one question from each chemistry dimension. Within each category it chooses the least-covered wording, counting pending wording reservations as well. This lab uses the 21 standard templates with single-skill links; arbitrary company multi-skill weights are outside this prototype.

Skill coverage concerns the employee across colleagues; chemistry coverage concerns the specific pair and direction. Wording variety can be balanced across multiple pending surveys about the employee. All five questions in a survey still concern its one selected colleague.

The three-survey example is allocated sequentially, reserving each result before choosing the next. With the seeded Alice example, ignoring reservations produces seven distinct wordings; counting reservations produces 15 across the same 15 planned questions. Zero duplication is not a universal requirement: there are only five skills and three wordings per category, and repeated coverage is sometimes appropriate.

The API now implements opt-in allocation and reservations under its company transaction/lock; see [adaptive question selection](../docs/question-selection.md). The lab allocator remains an independent experiment. Completion releases the pending reservation and adds only observed coverage. Null answers leave an evidence gap. Skips and replacement release/reassign reservations; actionable open requests retain them. Reservation weight and production performance scoring still need validation.

## Verification

The original eight model tests cover deterministic five-person data, missing/zero ratings, recency, duplicate reviewer-weeks, isolated high/low anomalies, restoration after repeated changes, same-week repetition, employee and direction isolation, and reservation allocation/release. A DOM smoke check with jsdom additionally exercised initial rendering, both presets, applying/repeating/resetting, allocation and settings controls, and self-feedback rejection. It was not a visual browser review or real employee usability test.


## Reviewer calibration experiment

The lab now includes a **reviewer-adjustment toggle**, off by default, a maximum-correction slider, and diagnostics showing matched units and other colleagues per reviewer. Original synthetic cards and the completed Carla→Alice session remain unchanged in the default mode. The benchmark section compares four models over ten scenarios × twenty deterministic seeds: recency alone, the current outlier model, adjustment plus recency, and adjustment plus the current model. Read [benchmark-results.md](benchmark-results.md) or inspect the complete [JSON results](benchmark-results.json). `npm run simulate` rebuilds both outputs and the self-contained lab.

The comparison uses a separate, known skill matrix to generate answers. The scoring functions receive only reported evidence, never those skill labels. Each full scenario has 16 weeks, five respondents, two colleagues/week, and five answers per survey (800 answers); the sparse scenario has three weeks and missing answers. Twenty seeds vary noise and occasional extreme answers, not the underlying skill/bias matrix. This is a reproducible stress test, not evidence of real-world measurement validity or a representative population study.

### Bounded adjustment

For a reviewer and employee being scored:

1. Exclude **every answer about that employee**, plus all chemistry answers, from learning the reviewer's tendency. This prevents that pair's own disagreement being used to explain itself away.
2. Collapse evidence to the original reviewer/subject/skill/week units. Match the reviewer's ratings with other reviewers rating the **same colleague and same skill** within 21 days of that rating, using only records available by the evaluation date. Nearby later ratings can be used for retrospective estimation, never ratings later than the evaluation date.
3. Require at least two different peer reviewers in a matched comparison. Average peer reviewers equally, with recency weighting within each peer's history.
4. Calculate rating-minus-peer-reference residuals. Average within each reviewed colleague, then give each colleague equal influence on the tendency estimate. This reduces distortions from one frequently reviewed person.
5. Require at least eight matched units across three other colleagues. Otherwise apply zero correction. This often means no adjustment for a new reviewer or a small dataset.
6. Shrink the residual toward zero by `effective evidence / (effective evidence + 12)`. Cap the result at ±0.5 stars by default. These thresholds are experimental and the cap is adjustable.
7. Subtract the estimated generosity (or add back estimated harshness) to skill evidence, bounded to 1–5. Keep original answers intact. Then run the recency estimator, with or without the current outlier rule for comparison. Counts and question-allocation coverage remain based on actual observations.

This is **relative calibration**, not a claim about motive or objective evaluator reliability. It does not use a reviewer's overall average, force employee scores to average, label friendship, or reduce feedback just because chemistry is poor. Pair effects concerning other colleagues can still contaminate the learned tendency. Bias shared by the whole reference group has no internal anchor. Skill-specific reviewer tendencies and changing project/task context remain unresolved.

With calibration enabled, one employee's new feedback can update a reviewer baseline used for another employee's skill estimate; the current colleague's own evidence is excluded from learning its correction. The interface states this coupling explicitly. Chemistry is always computed from the original directional answers and is unaffected by this reviewer adjustment. The experiment does not implement special surprise bonuses for an unusually positive or negative answer.

### Findings with default parameters

| Synthetic case | Current model error | Reviewer adjustment + current model error |
| --- | ---: | ---: |
| Generally harsh/generous reviewers | 4.97 | 2.67 |
| Pair-specific friendship/dislike | 8.87 | 12.01 |
| Relationship impressions overwhelm skills | 17.40 | 20.92 |
| No systematic reviewer bias | 2.73 | 2.72 |

Errors are average absolute differences from known current skill, in 0–100 points; lower is better. The UI also shows recency-only results, the number of seeds improved, missing-data coverage, the actual versus estimated spread of skills, and changes after four rounds for genuine improvement/deterioration. Overall error averages all 25 employee-skill cells, so it must be read alongside the specific changing employee's movement. Some sparse skill cells remain unscored rather than receiving a default score.

The existing outlier rule also worsens several pair-bias and genuine-change cases compared with recency alone. Adding correction on top can compound this. These results support retaining the controls for exploration, not adopting either adjustment as a universal fix. Historical agreement does not determine accuracy, and chemistry is not a valid automatic discount on criticism.

Eight additional tests cover bounds/shrinkage, excluding the current colleague and future records, sparse/unmatched histories, duplicate weeks, raw-answer and chemistry preservation, equal-skill teams, baseline compatibility, truth-label isolation and benchmark coverage/change directions. The standalone DOM checks exercise calibration on/off, correction bounds, benchmark cases, original default cards, chemistry invariance and apply/repeat/reset. No production API or database code was changed for this experiment; its integration suite was not rerun.


## Isolated versus recurring feedback patterns

The [pattern results](feedback-pattern-results.md) and [complete traces](feedback-pattern-results.json) compare recency alone with the current outlier rule. Reviewer calibration is off throughout. The standalone lab adds a selectable chart and all checkpoints under “Isolated answer or lasting change?”. `npm run simulate` rebuilds these outputs as well as the earlier reviewer benchmark.

Twelve deterministic trajectories use the same seeded Alice technical history. Low-rating cases begin at 91.27 internal points and use 1-star unusual reports. High-rating cases mirror **only** Alice's technical history using `6 − rating`, giving a hypothetical 8.73-point baseline, and then use 5-star reports. This makes positive/negative surprises symmetric; it does not change Alice's actual saved card or her completed Carla→Alice survey.

For each direction, the primary cases are: one unusual report then usual feedback; repeated weekly reports from Carla; and the same reports from Carla/Bob/Dan in rotation. A usual-feedback control provides a reference for ordinary changes. These all have exactly one survey per weekly round for eight rounds, beginning on the simulation date and ending 49 days later. The Carla-only and rotating-reviewer cases have identical dates, values and volume, so their comparison isolates reviewer identity. Each survey contains five answers, with technical rated and the other four explicitly unobserved, to isolate this metric.

Two context cases per direction add continuing reports from everyone: one unusual reviewer plus three usual reviewers, or three unusual reviewers plus one usual reviewer. Both have four surveys per round and 32 in total. Each reviewer submits at most once per round, so same-week duplicates cannot create artificial confirmations. A colleague can receive four surveys from four different reviewers without any respondent exceeding the existing one/two-colleague cap.

The synthetic evaluator assumes unchanged underlying skill for controls, isolated reports and persistent Carla-only cases. It assumes a real change for repeated multi-reviewer cases. Those labels **do not enter scoring**. They demonstrate possible false alarms and responsiveness, not a way to decide who is right. One colleague can notice a real, context-specific issue, while several colleagues can share a bias. Identical ratings with different stories remain ambiguous.

### Main findings

| Eight-round low-feedback case | Recency alone | Current outlier rule |
| --- | ---: | ---: |
| Usual feedback control | 90.51 | 90.51 |
| One low report, then usual feedback | 85.63 | 88.88 |
| Carla repeatedly reports 1 star | 35.92 | 12.74 |
| Three colleagues take turns reporting 1 star | 35.92 | 12.74 |
| Carla reports 1; three colleagues continue usual feedback | 70.83 | 70.83 |
| Three colleagues report 1; one continues usual feedback | 32.10 | 32.10 |

The high-feedback counterfactual gives complementary scores. For example, repeated 5-star reports produce 64.08 with recency alone and 87.26 with the outlier rule, from a starting point of 8.73.

Two weaknesses are now explicit:

- The restoration rule counts reviewer-week units, not independent reviewers. Three weekly reports from Carla restore full influence after the third round (14 elapsed days), just like reports from three different colleagues on those dates. Both formulas consequently produce identical primary trajectories for one versus several reviewers.
- The outlier rule can flip its interpretation: once the new ratings dominate the weighted median, old ratings become unusual. By round eight of the persistent low-rating cases, all 16 original technical evidence units retain only 25% influence. The rule then moves the score **more** than recency alone. Its effect is not limited to dampening an isolated answer.

The cases with other reviewers continuing to report provide essential context and different results. Recent volume and time also matter: an old body of feedback plus one person reporting over many weeks is not equivalent to a current multi-person view. Recency alone remains vulnerable to sparse coverage and persistent biased reports; it is a comparison baseline, not a validated solution. No production formula has been selected or changed.

Eight new tests check mirrored histories and original-data preservation, matched timing/volume, full five-answer survey records, one-versus-several identity comparisons, restoration after three reports, old-evidence discounting, isolated versus recurring effects, symmetry, context volume, and future/assumed-truth isolation. Together with earlier model/calibration tests, `npm run test:simulation` now runs 30 tests, including the six source-evidence tests below. DOM verification also covers pattern selectors, all nine checkpoints, mirrored/context cases, and compatibility with existing lab controls. Production API tests were not rerun for this separate study.


## Source diversity as a separate descriptive signal

`simulation/evidence.mjs` adds skill evidence diagnostics to the live employee card and every checkpoint of the pattern study. Scores, original answers, outlier factors, calibration options, and pending reservations are unchanged. Six new tests verify those boundaries; all 30 simulation tests pass.

The diagnostics use actual rated reviewer/employee/skill/week units in a **42-day inclusive rolling window**. Future answers, explicit nulls and older units do not enter these recent-source counts. This window is distinct from the scoring formulas, which keep decaying older evidence indefinitely. A single reviewer can therefore be the only recent source even when other colleagues still contribute older score evidence.

- **Recent reviewers:** unique people with an observed rating for this employee and skill inside the window. Repetition across weeks does not create extra people.
- **Recent evidence units:** reviewer-week units after the existing same-week grouping. Duplicate answers do not create extra coverage.
- **Largest reviewer share:** the largest person's fraction of recency-weighted evidence within the window, using the configured half-life. It is not the person's share of the entire historical score and does not discount their opinion.
- **Between-reviewer spread:** the recency-weighted standard deviation of each reviewer's mean star rating. This describes disagreement between their reported averages, not objective error or skill variation. With fewer than two people it is absent, not zero agreement. A real skill change observed at different times can also produce spread.
- **Latest age:** days since the latest observed unit, retained in the JSON/function output for inspection. No observations means null, not an assumed neutral score.

The diagnostic does not produce a confidence percentage, reliable/unreliable badge or automatic weight change. Different people can share a bias; four identical answers do not prove accuracy. One person's repeated experience remains useful without being counted as independent corroboration. Directional chemistry is excluded from cross-reviewer diversity diagnostics because a person's experience with a colleague naturally has one respondent.

At the last round of the low-feedback study:

| Case | Recent reviewers | Recent units | Largest share | Between-reviewer spread |
| --- | ---: | ---: | ---: | ---: |
| Carla-only repetition | 1 | 7 | 100% | Not assessable |
| Three rotating reviewers | 3 | 7 | 43.4% | 0 stars |
| Carla differs; three peers continue usual feedback | 4 | 28 | 25% | 1.54 stars |

The eight-round study spans 49 days, so the first new round has left the 42-day diagnostic window by the last round. That is why the first two rows contain seven recent units although eight surveys were applied. The current outlier score and recency-only score still match their earlier recorded values exactly. The next design decision can address how to present limited coverage, concentrated evidence and differing experiences without pretending to infer truth.
