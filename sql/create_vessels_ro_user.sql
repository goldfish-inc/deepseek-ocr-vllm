-- Create read-only user for PostGraphile
-- Run this in Supabase SQL Editor

-- 1. Create the role
CREATE ROLE vessels_ro WITH LOGIN PASSWORD 'CHANGE_THIS_PASSWORD';

-- 2. Grant connection to database
GRANT CONNECT ON DATABASE postgres TO vessels_ro;

-- 3. Grant usage on public schema
GRANT USAGE ON SCHEMA public TO vessels_ro;

-- 4. Grant SELECT on all existing tables in public schema
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vessels_ro;

-- 5. Grant SELECT on all future tables (so new tables are auto-accessible)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO vessels_ro;

-- 6. Grant EXECUTE on the specific functions needed
GRANT EXECUTE ON FUNCTION public.search_vessels(text, text, text, int) TO vessels_ro;
GRANT EXECUTE ON FUNCTION public.vessel_report(uuid) TO vessels_ro;

-- 7. Verify the grants
SELECT
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'vessels_ro'
ORDER BY table_name;

-- After running this:
-- 1. Generate a strong password (replace CHANGE_THIS_PASSWORD above)
-- 2. Save password to 1Password
-- 3. Connection string will be:
--    postgres://vessels_ro:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
--    (replace <password> with your generated password)
