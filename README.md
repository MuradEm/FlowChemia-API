# FlowChemia API

PostgreSQL 17, Prisma 7.10.1, Node.js 24. The first authentication, company and team API is implemented and tested.

## Local setup

From this repository:

```sh
npm ci
cp -n .env.example .env
docker compose up -d --wait
npm run db:validate
npm run db:migrate
npm run db:generate
npm run build
npm test
npm start
```

The example credentials are for local development only. PostgreSQL is bound to loopback. Stop it with `docker compose stop`; the named volume retains data. Never delete the volume to refresh dependencies.

The native Prisma CLI requires HTTPS access to `binaries.prisma.sh`, including checksum downloads. Keep signature, checksum and TLS verification enabled.

### Current cloud instance

PostgreSQL is running. The initial migration is registered in Prisma migration history; do not run `migrate resolve` again. Native schema validation, client generation, migration deployment, schema comparison, and all six database integration tests pass. The existing schema was preserved without resets.

The packaged WebAssembly validator used by `npm run db:validate` also works without native downloads. Run `npx prisma validate` for the native CLI check.

See [database design](docs/database.md) for product decisions and remaining application responsibilities.

For Windows, first-account provisioning and the connected browser application,
follow [local frontend and backend setup](docs/local-frontend.md). The frontend
is available in [FlowChemia](https://github.com/MuradEm/FlowChemia).

For the first account on a fresh database, `npm run bootstrap -- --interactive`
prompts for your credentials without echoing the password and creates the owner
company atomically. It refuses to overwrite existing accounts. JSON stdin
remains supported; validation and database errors provide safe diagnostics.

## API development

See [API setup, endpoints and permissions](docs/api.md) for account bootstrap, login, invitations and scoped team management.

Verified: frozen-lockfile installation (`npm ci`), schema validation, migration deployment, Prisma client generation, TypeScript compilation, six database tests, two upgrade-preservation tests, two password/token tests, five bootstrap-input tests, one bootstrap database integration test, five calendar tests, six question-selection tests and sixty-one HTTP integration scenarios (plus their parent tests). The HTTP and bootstrap integration tests use disposable databases without changing development data. Interactive terminal setup was also checked for successful account/company creation without password echo.

`npm start` binds to loopback port 3001. `GET /health` verifies database connectivity. The [survey API](docs/surveys.md) supports configurable feedback periods, versioned questions, private assignments and transactional submission. The sibling frontend supports login and the employee survey flow; analytics endpoints remain unimplemented. Invitations use manual development delivery rather than email.

The [participation API](docs/participation.md) supports voluntary skips, colleague replacement and percentage credit: completion 100%, voluntary skip 60%, and no credit yet for replacements or insufficient opportunity. Fixed point values and the reward catalogue remain future company configuration.

The [completion report API](docs/reports.md) provides aggregate company/team progress counts with role checks, issuance-date and survey-kind filters, and replacement-aware accounting. It exposes no individual answers or participation ledger entries.

Company-controlled [automatic scheduling](docs/scheduling.md) supports weekly, fortnightly and calendar-monthly cycles. Periodic surveys stay open without expiry; an unresolved batch blocks later cycles and missed cycles never accumulate.

The [question library](docs/questions.md) provides 15 standard questions across five skills plus six pairwise chemistry questions, HR approval for company drafts, and unobserved answers without numerical ratings. Managers and team leaders can propose questions; HR must approve them before survey use.

New surveys contain five rating questions with a two-minute design target: normally three skill questions and two chemistry questions, with a four-skill/one-chemistry alternative. Written survey answers are not accepted. Older issued work stays intact; old automatic selections require five-question reconfiguration before re-enabling. See [survey format](docs/surveys.md#survey-length-and-answers).

The separate [experimental formula lab](simulation/README.md) provides a self-contained [interactive five-employee simulation](simulation/flowchemia-lab.html). Build it with `npm run simulate` and validate the candidate model with `npm run test:simulation`. Its alternative score formulas remain experimental. The accepted baseline model now powers [employee cards and team insights](docs/insights.md), with numerical summaries stored internally and qualitative API responses. The API now supports opt-in [adaptive question selection](docs/question-selection.md), including per-assignment questions and pending coverage reservations.

The lab also compares bounded reviewer adjustments against known synthetic skill levels across ten scenarios and twenty seeds. Its [benchmark results](simulation/benchmark-results.md) include failure cases from friendship/dislike effects. Calibration remains an optional experiment and is off by default.

The lab now includes an [isolated/repeated feedback comparison](simulation/feedback-pattern-results.md), with matched reviewer timing and volume, positive/negative counterparts, continuing-peer context and an interactive timeline. Reviewer calibration stays off in this study; the current outlier rule remains experimental.

The experimental lab now shows recent reviewer diversity, evidence concentration and between-reviewer disagreement separately from skill scores. These are descriptive diagnostics, not a confidence percentage or a new weighting rule.

The completed fresh-team exercise led to a [current scoring decision](docs/scoring.md): revised star values and a 70-point starting baseline weighted like five reports, with real evidence displayed separately. The comparison is reproducible; production scoring remains unimplemented.

The [frontend starting point](docs/frontend-start.md) records the employee flow and the remaining joint design decisions. Browser testing against a disposable database verifies login, company isolation, real submission/skip/replacement, expired sessions, logout, historical question counts and uncertain-response recovery without changing development data.
