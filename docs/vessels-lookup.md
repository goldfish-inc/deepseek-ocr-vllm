Vessels Lookup Integration

Overview
- Uses a separate Supabase project for the vessels dataset (optional).
- UI routes: `/vessels/search` and `/vessels/entity/:id`.
- Reads from `public.vessels` and views `ui_entity_summary`, `ui_vessel_conflicts`.

Env Vars
- Add to `.env.local` (or Vercel envs) if using a separate project:
  - `VITE_VESSELS_SUPABASE_URL`
  - `VITE_VESSELS_SUPABASE_PUBLISHABLE_KEY`
  - Optional staging/prod variants also supported.
- If unset, the app falls back to the main Supabase client.

RPC + Views (DB-side)
- Optional SQL for the dataset project: `sql/vessels_lookup.sql`.
- Provides `search_vessels(q text, limit_n int)` RPC for fuzzy name search.

Local Dev
- Start app: `pnpm dev` and open `/vessels/search`.
- Type 7-digit IMO, 9-digit MMSI, or a name to search.
