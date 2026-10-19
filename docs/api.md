# Company and team API — first implementation

NestJS, TypeScript and Prisma. The current authentication choice is local passwords with opaque bearer sessions, allowing development without selecting a hosted identity provider. There is no public signup. This is a development implementation; email delivery, recovery and a shared rate-limit store are not yet implemented.

## Starting the API

From the API checkout (copy `.env.example` to `.env` first if needed):

```sh
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:generate
npm run build
npm start
```

The API binds to loopback on port 3001 (`PORT` may override the port). `GET /health` checks an actual database query. There are no browser preview links. No CORS origins or proxy trust are enabled yet.

## First account

The operator provisions exactly one account on an empty user table. For a local terminal, run `npm run bootstrap -- --interactive`: hidden password prompts create the first account and owner company atomically. JSON stdin remains supported; an optional `companyName` creates the company too, otherwise create it later through the API. The bootstrap command never overwrites an account and refuses to create a second account. For automation, supply JSON on stdin rather than putting a password in command-line arguments, source files or shell history. Input validation and database failures produce safe diagnostics without echoing credentials. For example, from an interactive terminal:

```sh
python3 -c 'import json,getpass,sys; print("Email: ",file=sys.stderr,end="",flush=True); email=input(); print("Name: ",file=sys.stderr,end="",flush=True); name=input(); print(json.dumps({"email":email,"displayName":name,"password":getpass.getpass("Password (12–128 characters): ")}))' | npm run bootstrap
```

The operator must establish the identity of this first account. This does not constitute verified email signup. New colleagues enter through an invitation. Do not expose public signup or deploy with real employees until identity, delivery, recovery and deployment controls are reviewed.

## Endpoints

All routes except health, login and invitation acceptance require `Authorization: Bearer <session token>`. Invitation acceptance requires the invited account's session if the email already belongs to an account. No cookies are used.

| Method | Path | Access / body |
| --- | --- | --- |
| GET | `/health` | Public database readiness |
| POST | `/auth/login` | `{email, password}` → session token and expiry |
| POST | `/auth/logout` | Revokes current session |
| GET | `/me` | Own profile and active company memberships |
| POST | `/organizations` | Signed-in user; `{name}`; creates owner membership transactionally |
| GET | `/organizations/:orgId` | Active company member |
| GET | `/organizations/:orgId/members` | Owner / HR; up to 200 profiles |
| POST | `/organizations/:orgId/invitations` | Owner / HR; `{email, role?}` |
| POST | `/invitations/accept` | `{token, displayName, password}` for new users; existing users supply only `{token}` and their session |
| GET | `/organizations/:orgId/teams` | Administrators see all; others see participating or managed teams; up to 200 |
| POST | `/organizations/:orgId/teams` | Owner / HR; `{name, startsAt?, endsAt?}` |
| GET | `/organizations/:orgId/teams/:teamId` | Scoped team roster; no colleague emails or analytics |
| POST | `/organizations/:orgId/teams/:teamId/members` | Owner / HR / assigned manager; `{membershipId}` |
| DELETE | `/organizations/:orgId/teams/:teamId/members/:membershipId` | Same; closes participation interval, retains history |
| POST | `/organizations/:orgId/teams/:teamId/access` | Owner / HR; `{membershipId, role}` |
| DELETE | `/organizations/:orgId/teams/:teamId/access/:membershipId` | Owner / HR; removes team authority |

Invitation roles are `EMPLOYEE` or `HR_ADMIN`; only the owner can invite HR. Invitations cannot grant ownership or overwrite an existing company membership. Team access roles are `MANAGER` and `TEAM_LEADER`. Team leaders must participate; managers may be assigned without participating. Independent HR cannot participate or hold a team role. Leaving a team revokes its team-leader grant; an explicit manager grant remains until revoked.

Employee membership and team access are checked server-side on every request. An outsider receives 404 for an inaccessible company or team; an active company member attempting an unauthorized operation receives 403. IDs and caller-supplied company scope are never treated as authorization.

## Credential handling

Passwords are salted with scrypt (N=32768, r=8, p=1). Session and invitation tokens use 32 random bytes; only SHA-256 digests are stored. Sessions last 12 hours and logout revokes them. Invitations expire after 48 hours and are claimed transactionally once. An invitation for an existing account never changes its password.

For local development only, the invitation creation response contains a one-time delivery token. This is an administrative secret. There is no email transport, and it must be delivered through a trusted channel by the operator. Do not log tokens or expose this response to employees. Hosted deployment should replace this delivery mechanism with verified email delivery, not automatically email tokens through this development environment.

Login and invitation acceptance have a bounded process-local limit of 10 attempts per minute per IP. Distributed rate limiting, password recovery, email verification, session cleanup and security audit records are future requirements. Password changes and account deactivation endpoints have not been added.

## Tests and current execution status

`npm run test:api` builds first and exercises the HTTP API using a disposable PostgreSQL database. The configured development database account needs permission to create/drop that test database. It does not reset the development database. Tests cover bootstrap, authentication, overlapping teams, role grants, tenant isolation, invitation expiry/reuse, existing-account protection, inactive membership, session expiry, logout and throttling.

Verified: dependency installation from the lockfile, schema validation, migration deployment, client generation and the TypeScript build. All six database integration tests, two upgrade-preservation tests, two password/token tests, five calendar tests, and fifty-three HTTP integration scenarios pass (the HTTP runner reports fifty-nine tests including six parents). Startup is validated with a database-backed health request. No runtime network blocker remains.

The survey, skill-definition and feedback-submission endpoints are documented in [survey API](surveys.md). No chemistry or skill-score endpoints exist in this slice. The personal relationship restriction remains a requirement for the analytics slice; no raw scores or feedback are returned here.

Assignment skip/replacement actions and private normalized credit history are documented in the [participation API](participation.md). Actual company point amounts are not fixed by this implementation.

Aggregate company/team completion reports and their access/filter rules are documented in the [report API](reports.md).

The [scheduling API](scheduling.md) configures company cadence, timezone, generation time, question selection and automatic opt-in. `npm start` now starts its worker.
