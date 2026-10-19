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

With the API running, open a second PowerShell terminal in the API checkout.
This example prompts for your own credentials, bootstraps the first account,
creates your company, then revokes its temporary setup session. Choose a
password of 12–128 characters; do not share it in chat or commit it to Git.

```powershell
$flowchemiaEmail = Read-Host 'Your email'
$flowchemiaName = Read-Host 'Your display name'
$flowchemiaSecret = Read-Host 'Your password (12-128 characters)' -AsSecureString
$flowchemiaPassword = [System.Net.NetworkCredential]::new('', $flowchemiaSecret).Password
try {
  @{ email = $flowchemiaEmail; displayName = $flowchemiaName; password = $flowchemiaPassword } |
    ConvertTo-Json -Compress | npm.cmd run bootstrap
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap did not complete. Do not reset existing data.' }

  $flowchemiaLoginBody = @{ email = $flowchemiaEmail; password = $flowchemiaPassword } | ConvertTo-Json
  $flowchemiaSession = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/auth/login' -ContentType 'application/json' -Body $flowchemiaLoginBody
  $flowchemiaHeaders = @{ Authorization = "Bearer $($flowchemiaSession.token)" }
  try {
    $flowchemiaCompanyName = Read-Host 'Company name'
    $flowchemiaCompany = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/organizations' -Headers $flowchemiaHeaders -ContentType 'application/json' -Body (@{ name = $flowchemiaCompanyName } | ConvertTo-Json)
    Write-Host "Created company: $($flowchemiaCompany.organization.name)"
  } finally {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/auth/logout' -Headers $flowchemiaHeaders | Out-Null
  }
} finally {
  Remove-Variable flowchemiaPassword, flowchemiaLoginBody, flowchemiaSession, flowchemiaHeaders, flowchemiaSecret -ErrorAction SilentlyContinue
}
```

The company creation endpoint makes this first account its owner. New colleagues
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
