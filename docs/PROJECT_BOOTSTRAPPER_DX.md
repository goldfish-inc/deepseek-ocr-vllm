# Project Bootstrapper - Developer Experience Improvements

**Date**: 2025-10-16
**Context**: Oceanid is an internal data pipeline tool. We prioritize dev speed over production hardening.

## Problem Statement

Iterating on `project-bootstrapper` was slow due to:
1. **Image caching**: Kubernetes cached `:main` tag, new builds didn't deploy
2. **No debugging tools**: Container had no curl/jq/bash for troubleshooting
3. **Poor logging visibility**: `log.Printf` made it hard to parse HTTP responses
4. **Slow feedback loop**: Push → Build → Deploy → Debug took 5+ minutes per iteration

## Solutions Implemented

### 1. Added Debugging Tools to Container

**File**: `apps/project-bootstrapper/Dockerfile:20`

```dockerfile
# Install CA certificates and debugging tools for internal dev velocity
RUN apk --no-cache add ca-certificates curl jq bash
```

**Benefit**: Can now exec into container and debug API calls directly:
```bash
kubectl exec -n apps deployment/project-bootstrapper -it -- bash
curl -H "Authorization: Bearer $TOKEN" http://label-studio-ls-app.apps.svc.cluster.local:8080/api/webhooks/?project=15 | jq
```

### 2. Force Image Pull on Every Deployment

**File**: `cluster/src/components/projectBootstrapper.ts:82`

```typescript
imagePullPolicy: "Always", // Force pull :main tag for fast internal dev iteration
```

**Benefit**: New builds always deploy, no more stale image cache issues.

### 3. Structured Logging with slog

**File**: `apps/project-bootstrapper/main.go:534-542`

```go
// Configure structured logging based on LOG_LEVEL (default: info)
logLevel := slog.LevelInfo
if os.Getenv("LOG_LEVEL") == "debug" {
    logLevel = slog.LevelDebug
}
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: logLevel,
}))
slog.SetDefault(logger)
```

**Updated log lines**:
- `fetchProjectWebhooks()`: Line 258 - Logs full HTTP response body on errors
- `configureProjectWebhooks()`: Lines 316, 341 - Logs webhook registration failures with full context

**Example output**:
```json
{
  "time": "2025-10-16T12:34:56Z",
  "level": "ERROR",
  "msg": "webhook fetch failed",
  "project_id": 15,
  "method": "GET",
  "url": "http://label-studio-ls-app.apps.svc.cluster.local:8080/api/webhooks/?project=15",
  "status": 401,
  "response_body": "{\"detail\":\"Authentication credentials were not provided.\"}",
  "error": null
}
```

**Benefit**: Logs are now machine-parseable, show actual API responses, and can be filtered by level.

## Usage

### Enable Debug Logging

Add to Pulumi deployment (`cluster/src/components/projectBootstrapper.ts`):
```typescript
env: [
  { name: "LOG_LEVEL", value: "debug" },
  // ... other env vars
]
```

Or set via kubectl:
```bash
kubectl set env -n apps deployment/project-bootstrapper LOG_LEVEL=debug
```

### Debug Inside Container

```bash
# Get a shell
kubectl exec -n apps deployment/project-bootstrapper -it -- bash

# Test Label Studio API directly
ACCESS_TOKEN=$(curl -s -X POST http://label-studio-ls-app.apps.svc.cluster.local:8080/api/token/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh": "YOUR_REFRESH_TOKEN"}' | jq -r .access)

curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://label-studio-ls-app.apps.svc.cluster.local:8080/api/webhooks/?project=15 | jq
```

### Parse Structured Logs

```bash
# View recent error logs with full context
kubectl logs -n apps deployment/project-bootstrapper | jq 'select(.level == "ERROR")'

# Filter by project ID
kubectl logs -n apps deployment/project-bootstrapper | jq 'select(.project_id == 15)'

# Extract all failed webhook URLs
kubectl logs -n apps deployment/project-bootstrapper | jq -r 'select(.msg == "webhook fetch failed") | .url'
```

## Development Workflow

**Before** (5+ min/iteration):
1. Edit code
2. Push to GitHub
3. Wait for CI/CD build (~2 min)
4. Wait for deployment (~1 min)
5. Restart pod manually to force pull
6. Check logs (no visibility into HTTP responses)
7. Repeat

**After** (2 min/iteration):
1. Edit code
2. Push to GitHub
3. Wait for CI/CD build (~2 min)
4. Image auto-pulls on next restart
5. Check structured logs (see exact API response)
6. Debug in-container if needed

## Future Improvements (Optional)

### Hot Reload with Air (Local Dev)
```bash
cd apps/project-bootstrapper
air  # Rebuilds on file save
```

### Debug Endpoints (Self-Service)
Add HTTP endpoints to inspect state without kubectl:
```go
http.HandleFunc("/debug/projects", debugProjectsHandler)
http.HandleFunc("/debug/webhooks", debugWebhooksHandler)
```

Then: `kubectl port-forward -n apps svc/project-bootstrapper 8080:8080` → `curl localhost:8080/debug/webhooks?project=15`

## Related Issues

- Image caching caused 404 debugging to stall (couldn't see new logs)
- Authentication issues needed curl inside container to diagnose
- Webhook registration failures required structured response bodies

## References

- Go slog docs: https://pkg.go.dev/log/slog
- Kubernetes imagePullPolicy: https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy
