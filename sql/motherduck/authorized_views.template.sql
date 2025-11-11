-- Template for creating org-scoped authorized views in MotherDuck
-- Replace :ORG_ID and :DATASET as needed. Consider generating via a script.

create schema if not exists authorized;

create or replace view authorized.org_:ORG_ID_:DATASET as
select *
from curated.:DATASET
where visibility = 'public' or org_id = ':ORG_ID';

-- Optional: plan gating examples
-- and event_date >= now() - interval '90 days' -- free
-- limit 100000 -- proxy will enforce LIMIT as well
