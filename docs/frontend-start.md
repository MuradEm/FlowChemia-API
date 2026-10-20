# Frontend starting point

The API supports the first usable frontend flow: login, company/team context,
the employee's open assignments, assignment detail, five-question submission,
skip/replacement and personal participation history. Adaptive selection uses
the same assignment-detail response as manual selection.

The frontend repository `/workspace/FlowChemia` now contains the supplied
`design-kit/`: original logo assets, screen references, CSS and JSON tokens,
and `DESIGN_GUIDE.md`. It now contains a React/TypeScript/Vite frontend with
login, active company selection, employee home, server-issued surveys and
participation history. The kit specifies
light mode, teal/cyan/amber branding, Inter typography, and team-builder
overview/focus references. The product owner wants to develop the design and
user-facing behavior collaboratively. The guide's suggested React/Next.js
implementation is reference material, not an instruction to scaffold the app.

Use the supplied palette: primary `#0F4C5C`, secondary `#4FBDBA`, accent
`#F6AE2D`, background `#F8FAFC`, white surfaces and charcoal `#1F2933` text.
The kit describes manager-visible exact scores/tooltips, which conflicts with
the conversation's current qualitative frontend direction. Preserve the
conversation's decision; uploading reference material does not change score
visibility or authorize new analytics features. Unknown relationships remain
visibly distinct from observed neutral relationships.

Implemented first slice, with the user reviewing the design:

1. Employee home showing their pending colleague surveys.
2. One-colleague survey with five rating questions, explicit unobserved choices,
   submit, skip and colleague replacement.
3. Confirmation and return to the remaining assignments.

Login and real-mode requests use the API's bearer sessions through Vite's
development proxy. Session and company data remain in memory. The original
demo is available explicitly from login and stays separate from real data.
See [local setup](local-frontend.md) and the frontend README for startup and
failure behavior. Company setup, survey scheduling, custom question proposals/versioning, skill mappings and HR review are available in the frontend. Question-management actions follow the API capability response.

Respect the existing product rules: no written responses, no forced two-minute
timer, and replacement does not immediately earn participation credit. The
frontend obtains exact question IDs and wording from assignment detail; it must
not recreate question selection in the browser or interpret missing answers as
neutral ratings.

Employee cards and team overview now use the [insights API](insights.md).
The overview has no lines; selecting an employee requests only their connections.
The backend stores numerical summaries and returns only authorized qualitative
indicators. Owner administration does not imply insight access, and personal
relationship restrictions are enforced before serialization. Missing/early
feedback is neutral; real data never falls back to invented examples.
