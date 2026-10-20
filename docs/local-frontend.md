# Run the frontend and backend locally

Both repositories are required for real sign-in:

- Frontend: https://github.com/MuradEm/FlowChemia
- Backend: https://github.com/MuradEm/FlowChemia-API

Use Node.js 24 and a running Docker Desktop installation. PostgreSQL runs in
Docker; the Node API and frontend run in separate terminals. The browser uses
the frontend's `/api` development proxy, so no CORS changes are required.
The browser on your computer cannot use this cloud workspace's loopback API.

## 1. Start the backend

In Windows PowerShell, from the backend checkout:

```powershell
git clone https://github.com/MuradEm/FlowChemia-API.git
cd FlowChemia-API
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --wait
npm.cmd run db:migrate
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

If already cloned, use `git pull origin main` rather than cloning again.
Preserve your existing `.env` and database volume. Do not reset the database
or remove volumes when restarting. The API binds to loopback port 3001.
In another terminal, `Invoke-RestMethod http://127.0.0.1:3001/health` must return
`status: ok`. These loopback addresses are local checks, not shared previews.

## 2. Provision the first account on a fresh database

Use your existing account if one has already been provisioned. There is no
default login and no public signup. The bootstrap command refuses a nonempty
user table and never overwrites an existing account.

With the API running, open a second PowerShell terminal in the API checkout:

```powershell
npm.cmd run bootstrap -- --interactive
```

Enter your email, display name, company name and a password of 12–128 characters.
The password and confirmation are hidden while you type. Setup creates the first
account and its owner company in one transaction; it never overwrites existing
accounts. You can then sign in through the frontend. Do not share credentials
in chat or commit them to Git.

This interactive command avoids PowerShell JSON-pipe encoding differences.
Existing operator automation can still provide JSON on stdin; `companyName`
is optional in JSON mode. UTF-8 and BOM-marked UTF-16 input are supported.

If setup reports that an account already exists, use that account. Do not reset
or delete the database to repeat bootstrap. If you used the earlier JSON command
without a company name, it created only an account; create the company with the
existing `POST /organizations` API using that account's session.

If health returns 500 or Prisma reports `P1001`, check the database first:

```powershell
docker compose ps
docker compose up -d --wait
docker compose ps
npm.cmd run db:migrate
```

Docker Desktop must be running. The `db` service should be `Up (healthy)`.
If this still fails, check `docker compose logs --tail 40 db` locally and confirm
that port 5432 is available. Keep local database credentials private; preserve
both `.env` and the Docker volume. Successful client generation does not prove
that PostgreSQL is running: generation does not need a live database.

Interactive bootstrap makes the first account its company’s owner; the company creation API does the same when using JSON bootstrap without a company. New colleagues
join through invitations. Teams, question approval, and surveys are configured
using the existing APIs in [api.md](api.md), [questions.md](questions.md) and
[question-selection.md](question-selection.md). Those administrative screens
have not been built yet. A new company with no assignments correctly shows an
empty home; signing in does not create teams, surveys or rewards automatically.

## 3. Start the frontend

In a third terminal, from the frontend checkout:

```powershell
git pull origin main
npm.cmd ci
npm.cmd run dev
```

Open the development address printed in that terminal. Sign in with the account
you provisioned. Choose a company if you belong to more than one. With only one
active company it opens automatically. Switch company refreshes memberships;
no active memberships shows an invitation-required state.

Sessions remain in memory. Reloading the page requires signing in again.
Sign out revokes the current backend session and clears the screen. An expired
session returns to login. Browser storage contains only separately labeled
demo progress, never real account data, feedback answers or bearer tokens.

The backend is required for real login, but **Explore the demo** works without
it and never submits feedback. Real mode never substitutes sample data when
the API is unavailable. Production deployment/API routing is not configured.

## Update for employee cards and team insights

Stop the backend, preserve `.env` and the database volume, then run in the API checkout:

```powershell
git pull origin main
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

In the frontend checkout, pull main and restart `npm.cmd run dev`. Open **My teams**.
HR sees team insights; owners without an explicit manager/leader role see rosters
only. Employees see their own skills and own reported experiences. Existing
feedback is backfilled when a missing summary is first requested. New completions
save recalculated summaries automatically. See [insight rules](insights.md).

## Update for question management

Stop and update the backend first, from the API checkout:

```powershell
git pull origin main
npm.cmd run build
npm.cmd start
```

No new migration or dependency is required if employee cards already work.
In the frontend checkout, stop the dev server, run `git pull origin main`, and
restart `npm.cmd run dev`. The updated API provides the capability endpoint used
by the workspace navigation. Open **Question management** as an owner, HR,
current team manager or participating team leader. Only HR sees review actions.
See the [question workflow](questions.md#question-management-screen-and-capabilities).

## Update for company test mode

Stop the API and run in the backend checkout:

```powershell
git pull origin main
npm.cmd run db:migrate
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

Migration 11 defaults all companies to normal mode and preserves existing data.
Pull main in the frontend checkout and restart `npm.cmd run dev`. As owner or HR,
open **Survey settings → Test mode → Enable test mode**, then use **Generate test
surveys for everyone**. Finish outstanding surveys before requesting another batch.
No reset, dependency change or bootstrap rerun is needed. Test answers and credits
use the normal company data; turning mode off keeps them. See [test mode](test-mode.md).

Employee profile/photo updates require the additive `20261020120000_employee_profiles`
migration and the new sharp dependency. Follow the complete [profile update commands](employee-profiles.md#updating-an-existing-installation), including `npm.cmd ci`.
