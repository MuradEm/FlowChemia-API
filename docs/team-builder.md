# Team builder and personal card

The first team builder creates and edits real teams. It is a manual planning tool:
select employees, review permitted skill evidence, focus a person to inspect
chemistry, and explicitly save. It does not create task groups, fabricate an
aggregate fit score, automatically choose an optimal team or generate surveys.

## Permissions and feedback

- Owners and HR can create teams and edit any non-ended company team.
- Assigned managers can edit non-ended teams they manage. Their candidate pool
  contains themselves and participants in their managed teams. They cannot create
  a new team or assign manager/leader responsibilities through the builder.
- Owners and HR can assign multiple managers and leaders. Managers may be outside
  the selected participants; leaders must participate. HR is excluded from the
  candidate pool and responsibilities to preserve independence.
- Ordinary employees and team leaders do not receive builder access from those
  roles alone. The sidebar uses server capabilities to show the builder.
- Independent HR can review company-wide candidate insights. Other viewers see
  skills only for themselves or employees in teams they already manage. Owner
  administration alone does not grant access to employee feedback.
- Draft selection never grants insight access. Unavailable skill feedback stays
  absent. Relationships involving the viewer expose only that viewer's reports;
  incoming and combined feedback remain private. Other visible pairs require
  insight access to both employees.
- The overview contains no connection lines. Focusing a selected employee returns
  only permitted relationships involving that employee. Unknown, early and older
  evidence remains neutral under the existing model and five-band presentation.

Changing a team preserves membership history: removed participants receive a
`leftAt`, retained participation records keep their IDs, and new participation
records are added for newly selected people. Removed leaders lose that team role;
separate manager grants remain unless explicitly edited by HR or an owner.
Scores, survey answers and participation credits are preserved. Existing periodic
survey generation and unanswered-survey rules are unchanged.

## API

All endpoints require a bearer token and an active company membership.

| Method | Route under `/organizations/:orgId` | Purpose |
| --- | --- | --- |
| GET | `/my-card` | The caller's company profile and personal skill summaries, including when they have no team |
| GET | `/team-builder/capabilities` | Builder/create/role permissions and editable teams |
| GET | `/team-builder?teamId=…` | Scoped candidates and optional saved team draft/revision |
| POST | `/team-builder/preview` | Read-only projection for selected membership IDs and optional focus |
| POST | `/team-builder/save` | Atomic create or update with retry identity and optimistic revision |

A preview accepts `{membershipIds, focus?}`. A save accepts:

```json
{
  "requestId": "UUID generated once for this save attempt",
  "teamId": "existing team UUID; omit for a new team",
  "revision": "revision from the loaded draft; required for editing",
  "name": "PLC commissioning",
  "startsAt": "2026-10-21T09:00:00Z",
  "endsAt": null,
  "membershipIds": ["participant UUIDs"],
  "managerIds": ["manager UUIDs; HR/owner only"],
  "leaderIds": ["selected participant UUIDs; HR/owner only"]
}
```

Timestamps include a timezone. An end must be in the future and after the start.
The UI uses local date inputs and preserves the original timestamp when unchanged.
Role arrays are optional for owners/HR; omitting them retains existing roles,
except leader access lost through removal from participation. Managers must omit
both role arrays. Duplicate, cross-company, inactive and HR participants are
rejected before any team mutation is committed.

The catalog returns up to 200 candidates and 200 editable teams. Saves and previews
accept up to 100 distinct participants. Candidate filtering supports name/job title,
department and current feedback for a skill. If existing participants are outside
the visible catalog, saving is blocked and the UI directs the administrator to
resolve the roster in Company setup; the builder never silently drops them.

## Concurrent edits and uncertain saves

A company advisory lock covers builder saves and the existing roster/role APIs.
The draft revision fingerprints the saved team dates, name, participation record IDs
and responsibilities. A stale save returns 409 before any changes are applied.
Reload and review the latest draft before saving again.

Each save has a caller-generated request UUID. A small `TeamBuildRequest` record
stores its company, actor, payload digest and resulting team. Repeating the same
request returns the original team without applying changes again. Reusing a key
for a different actor/payload returns 409. The UI retains the exact request in
memory after an uncertain response and offers **Confirm previous save**; editing
is disabled until it is confirmed or the draft is explicitly discarded. No real
profile, selection, session token or save request is written to browser storage.

## Workspace navigation

All signed-in company screens use one persistent sidebar and sticky account header.
On small screens, the header's navigation button opens the sidebar as a drawer.
The account photo opens the caller's own card with links to their profile and teams;
Escape, outside clicks and focus leaving the popup dismiss it. Role-specific
navigation remains hidden without permission. Navigation warns before discarding
profile changes, team drafts, edited survey settings, unfinished questions or a
newly issued invitation token, and blocks leaving during relevant save operations.
Company selection, authentication and the offline demo remain separate workflows.

## Updating

Stop local servers. From the API checkout:

```powershell
git pull origin main
npm.cmd run db:migrate
npm.cmd run db:generate
npm.cmd run build
npm.cmd start
```

Migration `20261021090000_team_builder_requests` adds retry receipts only. Existing
accounts, teams, profile photos, surveys and score history are preserved. There are
no new dependencies or secrets. Use `npm.cmd ci` if updating from an older checkout
that has not installed the previously introduced photo dependency.

Pull the frontend checkout and restart `npm.cmd run dev`.

`tests/team-builder.test.mjs` verifies real database persistence, role/tenant scope,
preview redaction, no-survey creation, atomic failures, history preservation,
concurrent stale saves and request replay. Existing insight, authentication and
survey suites continue to exercise the shared permissions and projections.
