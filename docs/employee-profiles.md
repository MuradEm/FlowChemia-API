# Employee profiles and cards

Employee profiles belong to a company membership. The same user can have a different
job title, department, location, work email, work phone and portrait in another
company. Existing profiles start empty and use initials until a photo is added.
No sample job titles, contacts or portraits are assigned to real employees.

## Access

- Active employees can view their own profile and profiles of current teammates.
- Assigned managers can view and edit professional information for participants
  in the current teams they manage. Team leaders have the same profile editing
  rights as employees, unless separately granted a manager role for that team.
- HR administrators and company owners can view and edit professional information
  across the company, including people who are not in a team.
- Only the employee can upload or remove their own photo. A manager, owner or HR
  administrator cannot change another employee's portrait.
- Work email is a profile contact field. Changing it does not change sign-in email,
  identity, passwords, invitation delivery or existing survey history.
- Work contacts are visible to users permitted to view that profile. Sign-in email
  is never copied into work contacts automatically.

These checks run on the server for reads and writes, including photo retrieval.
Inactive memberships, ended teams and future teams do not confer profile access.
The frontend uses API capabilities to show editing controls only when permitted.
Existing skill and chemistry insight permissions and calculations are unchanged.
Cards continue to use qualitative labels and colours rather than exact scores.

## API

All routes require the usual bearer token and company scope:

| Method | Path under `/organizations/:orgId` | Purpose |
| --- | --- | --- |
| GET | `/employees` | Visible active people, ordered by name; up to 200 |
| GET | `/employees/:membershipId/profile` | Profile plus `canEditInfo` and `canEditPhoto` |
| PATCH | `/employees/:membershipId/profile` | Update selected professional fields |
| GET | `/employees/:membershipId/photo` | Authenticated JPEG data URL, or null |
| PATCH | `/employees/:membershipId/photo` | Replace own photo with `{dataUrl}` |
| DELETE | `/employees/:membershipId/photo` | Remove own photo; idempotent |

Profile PATCH accepts only `jobTitle`, `department`, `location`, `workEmail` and
`workPhone`. Send null to clear a field; omit fields to preserve them. Names,
roles and login credentials are not writable through these routes. Empty PATCH,
unknown keys, invalid emails, control characters and excessive lengths are rejected.
Job title, department and location allow 120 characters; email 254, phone 50.

Directory and team insights include photo modification timestamps, job title,
department and location, without photo bytes or work contacts. Photo requests are
separate, authenticated and `no-store`. Photos are not placed in browser storage
or public files, and access tokens are never embedded in image URLs.

## Photo storage

The UI accepts JPEG, PNG or WebP files up to 8 MB, shows a square centre-cropped
preview, and sends a resized 384px JPEG. The photo is saved explicitly using
**Save photo**; removal also needs **Save photo**, allowing cancellation.

The API independently decodes supported raster formats with sharp, rejects corrupt
or animated images and excessive pixel counts, applies orientation, centre-crops
to 384×384, strips metadata by re-encoding to JPEG, and bounds the stored result
at 100 KB. Arbitrary URLs and SVG are rejected. Only the photo endpoint accepts a
larger JSON body (192 KB); other API routes retain their existing 16 KB limit.

The normalized image is stored in PostgreSQL's `EmployeePhoto` table with a
company-scoped membership foreign key. No file system directory, public bucket,
new credentials or separate storage service is needed for this version. Normal
database backups now include portraits. Larger deployments can move image bytes
to private object storage without changing employee permissions.

## Updating an existing installation

Stop the API, then run from the API checkout:

```powershell
git pull origin main
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

Pull the frontend and restart `npm.cmd run dev` in its checkout. Preserve the
existing `.env`, accounts and database volume. Do not reset or bootstrap again.
Migration `20261020120000_employee_profiles` is additive. `npm ci` installs sharp
and its platform-specific image processing dependency; Node 24 remains required.

## Validation

`tests/profiles.test.mjs` creates a disposable database and exercises permissions,
company isolation, current-team scope, real image decoding/normalization, rejected
files, metadata removal, contact validation, login separation and card projection.
It runs with the existing `npm run test:api` / `npm test` commands.

## Five skill bands

Compact team cards show every active skill. Skill projections include `band`:
`RED` (below 20), `ORANGE` (20 to below 40), `YELLOW` (40 to below 60),
`LIGHT_GREEN` (60 to below 80) and `GREEN` (80–100). Shared boundaries belong to
the next band. This is categorical presentation; exact stored scores, formula,
model version, history and refresh behavior are unchanged.

For unobserved, early or older evidence, `band` is null and the evidence label
is retained. The baseline alone never creates a coloured rating. Other skill
labels are “Room for improvement” for red/orange, “On the way” for yellow and
“Doing well” for the greens. Relationship indicators retain their existing labels
and privacy rules.

Employee projections include `skillPresentation`: `BANDS` for authorized team
insight views (HR, assigned managers and participating team leaders), `SUMMARY`
for personal employee views. Summary cards show a coloured dot and text; team
views show five fixed segments filled through the current category. This field
never grants skill access: `skills` remains null for unauthorized subjects.
No migration or recomputation is needed to apply this presentation to existing
cached scores. Boundary, evidence and projection tests cover these rules.
