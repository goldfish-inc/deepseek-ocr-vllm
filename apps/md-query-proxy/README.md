# MotherDuck SQL Proxy (Near Real-Time)

A small HTTP service that executes SQL against MotherDuck using DuckDB + the MotherDuck extension. This provides a team‑controlled endpoint for Workers to write/read data in near real‑time without embedding the SQL client in Cloudflare Workers.

- POST `/query` with JSON body: `{ "database": "vessel_intelligence", "query": "SELECT 1" }`
- Auth: the proxy reads `MOTHERDUCK_TOKEN` from its environment; no per‑request Bearer token is required. Restrict network access via Cloudflare Access or private networking.

## Local Dev

```bash
cd apps/md-query-proxy
npm ci
MOTHERDUCK_TOKEN=md_... npm run start
# curl test
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/query \
  -H 'Content-Type: application/json' \
  -d '{"database":"vessel_intelligence","query":"SELECT 42 as answer"}'
```

## Container

```bash
# Build + run
docker build -t md-query-proxy:local .
docker run -e MOTHERDUCK_TOKEN=md_... -p 8080:8080 md-query-proxy:local
```

## K8s (tethys)

Manifests: `clusters/tethys/apps/md-query-proxy.yaml`
- Create a secret with your token:

```bash
kubectl -n apps create secret generic md-secrets \
  --from-literal=MOTHERDUCK_TOKEN=md_...
```

- Apply manifests and wait for readiness:

```bash
kubectl -n apps apply -f clusters/tethys/apps/md-query-proxy.yaml
kubectl -n apps rollout status deploy/md-query-proxy
```

- Expose via your existing Cloudflare tunnel/Access (recommended) and set Workers `MD_QUERY_PROXY_URL` to `https://<your-domain>/query`.

## Worker Integration

Set in `workers/vessel-ner/wrangler.toml`:

```toml
[vars]
MD_QUERY_PROXY_URL = "https://<your-domain>/query"
```

The Workers will POST `{ database, query }` with `Content-Type: application/json` and expect `{ data: [...] }`.

## Notes
- Uses DuckDB native Node bindings; deploy on a runtime that supports native modules (K8s is ideal).
- Keep SQL surface minimal; prefer only INSERT/SELECT used by the pipeline. Add an allow‑list if needed.
- Monitor request rate and add simple rate limiting if exposed publicly (recommend Access).
