# MotherDuck SQL Proxy (Near Real-Time)

A small HTTP service that executes SQL against MotherDuck using DuckDB + the MotherDuck extension. This provides a team‑controlled endpoint for Workers to write/read data in near real‑time without embedding the SQL client in Cloudflare Workers.

- POST `/query` with JSON body: `{ "database": "vessel_intelligence", "query": "SELECT 1" }`
- GET `/schema/tables?database=vessel_intelligence` → `{ tables: string[] }`
- GET `/schema/columns?database=vessel_intelligence&table=raw_ocr` → `{ columns: [{ name, type }] }`
- Auth: the proxy reads `MOTHERDUCK_TOKEN` from its environment; no per‑request Bearer token is required. Restrict network access via Cloudflare Access or private networking.

## Local Dev

```bash
cd apps/md-query-proxy
npm ci
MOTHERDUCK_TOKEN=md_... PROXY_MODE=rw MAX_ROWS=10000 MAX_MS=15000 npm run start
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
Read-only UI instance: `clusters/tethys/apps/md-query-proxy-ro.yaml`
- Create a secret with your token:

```bash
kubectl -n apps create secret generic md-secrets \
  --from-literal=MOTHERDUCK_TOKEN=md_...
```

- Apply manifests and wait for readiness:

```bash
kubectl -n apps apply -f clusters/tethys/apps/md-query-proxy.yaml
kubectl -n apps apply -f clusters/tethys/apps/md-query-proxy-ro.yaml
kubectl -n apps rollout status deploy/md-query-proxy
kubectl -n apps rollout status deploy/md-query-proxy-ro
```

- Expose via your existing Cloudflare tunnel/Access. Use the RW proxy (`md-query-proxy`) for pipeline writes, and the RO proxy (`md-query-proxy-ro`) for UI.
- Swordfish UI env: `MD_QUERY_PROXY_URL=https://<ui-domain>/query` (RO instance).

## Worker Integration

Set in `workers/vessel-ner/wrangler.toml`:

```toml
[vars]
MD_QUERY_PROXY_URL = "https://<your-domain>/query"
```

The Workers will POST `{ database, query }` with `Content-Type: application/json` and expect `{ data: [...] }`.

## Notes
- Uses DuckDB native Node bindings; deploy on a runtime that supports native modules (K8s is ideal).
- Modes: `PROXY_MODE=rw` (default) permits SELECT/INSERT/UPDATE/DELETE; `PROXY_MODE=ro` permits only SELECT/SHOW/DESCRIBE.
- Guardrails: dangerous statements (DROP/TRUNCATE/ALTER/ATTACH/DETACH/INSTALL/LOAD/SET) are blocked; `MAX_ROWS` caps SELECTs without LIMIT; `MAX_MS` caps runtime.
- Keep SQL surface minimal; prefer only required statements. Add an allow‑list if needed.
- Monitor request rate and add rate limiting if exposed publicly (recommend Cloudflare Access/Tunnel).
