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
