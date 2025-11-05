# PostGraphile on Fly.io (Supabase dataset)

This service runs PostGraphile as a tiny container close to Supabase (us-east).

## Prereqs
- Supabase pooled, read-only DSN with sslmode=require, e.g.
  `postgres://vessels_ro:<pass>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`
- Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
- Create a unique Fly app name, e.g. `ocean-postgraphile`

## One-time setup

```
cd apps/postgraphile
# Authenticate (paste your personal access token when prompted)
flyctl auth login

# Initialize app (update the app name)
sed -i.bak 's/ocean-postgraphile/<YOUR_APP_NAME>/' fly.toml

# Set region near Supabase (iad)
flyctl apps create <YOUR_APP_NAME>
flyctl regions set iad -a <YOUR_APP_NAME>

# Set secrets
flyctl secrets set DATABASE_URL="postgres://vessels_ro:...@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require" -a <YOUR_APP_NAME>

# Deploy
flyctl deploy --ha=false -a <YOUR_APP_NAME>

# Keep a single small instance warm
flyctl scale count 1 -a <YOUR_APP_NAME>
flyctl scale memory 256 -a <YOUR_APP_NAME>
```

## Test
```
curl https://<YOUR_APP_NAME>.fly.dev/graphql -s -o /dev/null -w '%{http_code}\n'
```

## UI wiring
- In the ocean repo (Vercel): set `VITE_POSTGRAPHILE_URL=https://<YOUR_APP_NAME>.fly.dev/graphql`
- Deploy the ocean app and navigate to `/dashboard/vessels/search`

## Notes
- CORS is enabled (`--cors`) for demo. For stricter origins, put PostGraphile behind Cloudflare or a small proxy.
- GraphiQL is not exposed; use local PostGraphile or Supabase SQL editor for ad-hoc queries.
- Rebuild schema by redeploying or scaling to 0/1 when you change views/functions.
