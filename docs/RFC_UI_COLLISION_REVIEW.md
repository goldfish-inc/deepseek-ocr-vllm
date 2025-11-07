# RFC: Collision Review Admin (EBISU)

Status: Draft
Owner: Data Platform
Scope: Dedicated UI project (separate repo)

## Goals
- Provide a secure, minimal UI to triage and resolve identifier collisions (IMO/MMSI).
- Operate strictly via GraphQL over PostGraphile; no direct DB access.
- Preserve a complete audit trail (reviewer, status, resolution, notes).

## Non‑Goals
- No ETL or transform logic in the UI.
- No metrics/dashboards/SLOs here (observability is a separate project).
- No arbitrary vessel edits beyond review actions on collision groups.

## Users & Roles
- Admin: full access to review actions and audit.
- Reviewer: can ack/resolve/dismiss/reopen.
- Read‑only: list and view details only.
- AuthN/AuthZ: Cloudflare Access (or app auth) maps identity to roles. UI forwards identity to GraphQL.

## Data Contract (already in prod DB)
- Queue view: `public.ui_collision_review_queue` (primary key: `queue_id`)
- Actions (mutations via SQL functions):
  - `public.resolve_collision(id_type, id_value, resolution, reviewer, notes)`
  - `public.ack_collision(id_type, id_value, reviewer, notes)`
  - `public.dismiss_collision(id_type, id_value, reviewer, notes, resolution='DATA_ERROR')`
  - `public.reopen_collision(id_type, id_value, reviewer, notes)`
- Helpers (queries):
  - `public.top_unresolved_collisions(limit_n)`
  - `public.collisions_for_vessel(vessel_uuid)`
  - `public.collisions_since(since_ts, unresolved_only)`
- Source tables (backend only): `ebisu.load_collisions`, `ebisu.collision_reviews`.
- Reference: `sql/ebisu_admin.sql`, `docs/ebisu-data-dictionary.md`.

## API Surface (PostGraphile)
- Endpoint: `https://graph.boathou.se/graphql` (WAF: GET blocked, POST rate‑limited).
- Schemas exposed: `['public','ebisu']`.
- Queries
  - List queue (filter by status, search by `id_type`/`id_value`, order by `collisions_count`, paginate).
  - Detail by `queue_id` or `(id_type,id_value)`.
  - Helpers listed above for top/unresolved, by vessel, since timestamp.
- Mutations
  - Call the four lifecycle functions (resolve/ack/dismiss/reopen).

## Key Screens
- List: unresolved queue with sorting by collisions_count/last_detected; filters for `id_type`, time window, status.
- Detail: shows involved vessel UUIDs, first/last detected, action history; action buttons and notes.
- Vessel context: deep‑link to read‑only vessel report (GraphQL `public.vessel_report`).
- Audit: show reviewer + notes for each state change.

## Security
- Cloudflare Zero Trust in front of the UI; GraphQL is POST‑only and rate‑limited.
- Least‑privilege DB role for UI; PostGraphile scopes to `public` and `ebisu` only.
- Optional RLS later if multi‑tenant needs emerge.

## Performance & UX
- Paginate list (25–50 rows). Debounce search. Sort by collisions_count desc then last_detected desc.
- Optimistic updates with server reconciliation.
- Bulk ack/dismiss as a future enhancement.

## Dependencies
- PostGraphile with connection filter plugin enabled.
- Observability (SLOs, dashboards) lives in a separate project.

## Milestones
- M1: Read‑only list + detail + helpers (top unresolved, by vessel).
- M2: Actions (ack/resolve/dismiss/reopen) + audit notes.
- M3: Filters/search/pagination polish; bulk ack.
- M4: Role gating, error handling, and release hardening.

## Acceptance Criteria
- All review actions go through GraphQL mutations backed by SQL functions; no direct table writes.
- Queue list and detail load within 300ms P95 server time under nominal load.
- Audit trail visible for every state transition with reviewer and timestamp.
- WAF blocks GET to `/graphql`; POST rate‑limits enforced.

## Open Questions
- Identity mapping: use Access JWT claims (email) directly as `reviewer` or resolve to a canonical username?
- Should we capture client IP/user‑agent alongside reviewer notes for compliance?
- Bulk operations permissioning (Admin‑only?)

## Rollout Plan
- Create a new repo (e.g., `oceanid-collision-review-ui`).
- Scaffold Next.js app with GraphQL client (Apollo/urql) and Access integration.
- Bind to PostGraphile URL via env; put behind Zero Trust.
- Ship M1 read‑only, then enable actions in M2.
