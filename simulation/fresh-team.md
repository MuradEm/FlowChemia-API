# Fresh five-person exercise

The exercise is now complete: all 30 surveys were answered. The subsequent
accepted baseline and revised star scale are documented in
[current scoring decision](../docs/scoring.md). Run
`node simulation/recalculate-fresh-team.mjs` to reproduce that comparison;
the original session and the original exercise scoring below remain intact.

The user requested a team of five with no scores and six surveys answered as each employee. Session `sessions/fresh-team-001.json` is the authoritative state. It starts with no events, skill scores or chemistry scores; it does not reuse seeded or previously completed survey evidence. Preserve the earlier Carla→Alice session separately.

The fictional employees are Alice, Bob, Carla, Dan and Elias. There are 30 surveys: six per respondent and six received per employee, across three simulated weekly rounds with two distinct colleagues per respondent per round. Every respondent reviews all four other colleagues over the first two rounds, then repeats two in round three. The first round starts on 19 October 2026; subsequent rounds advance the simulation only, with no real-world waiting.

Only the current round's ten surveys have generated questions. Future rounds remain PLANNED with no questions, so their selection can respond to actual answers. Generation uses the existing experimental allocation function and reserves each pending survey before choosing the next. Each survey contains three skill questions, one enjoyment question and one effectiveness question about the same colleague. Explicit null means unobserved.

For this exercise, displayed scores use **recency weighting alone**, half-life 42 days. Reviewer adjustment is off. The existing outlier estimate remains available only as a comparison field. No-evidence scores are null, not zero or a preset average. Early observed ratings can establish a high or low numerical estimate immediately; always show the amount and number of sources so it is not presented as an established ability. Chemistry remains directional; combined reported effectiveness stays absent until both directions have observations.

Use `nextFreshSurvey(session)` to get the next prompt. When the user supplies five 1–5/null answers, call `submitFreshSurvey(session, surveyId, answers)` and save the returned state to the same session file. It is immutable as a function, rejects future-round or conflicting resubmissions, and exact retries add no duplicate evidence. Use the frozen generated question IDs/wording. Never insert guessed answers or the test fixture answers into the real session.

`freshTeamCards(session)` returns current skill estimates, descriptive evidence and directional chemistry. Show the changed employee/direction after each response, along with the next survey. Show a full team comparison after each round. Once all ten current surveys are completed, the next adaptive round opens. The file retains all answers and all 30 survey slots for recovery. Six tests cover empty initial cards, allocation/counts, initial observations and direction isolation, invalid/repeated submissions, adaptive round generation and pending reservations; they are part of `npm run test:simulation` (36 tests total).

The user has been told the interpretation is six surveys per person, 30 total. First prompt: Alice reviewing Bob, with Technical Problem Solving, Communication, Teamwork, Enjoyment and Effectiveness. At preparation time there are zero completed surveys and zero answers. Continue from the actual saved file, rather than resetting it when this document becomes stale.
