# Label Studio ML Backend Connection

Connect the shared in‑cluster ML backend (`ls-triton-adapter`) to a project via the Label Studio UI.

## Steps
- Open your project
- Go to: Settings → Model → Connect model
- ML Backend URL: `http://ls-triton-adapter.apps.svc.cluster.local:9090`
- Authentication: none
- Optional: enable pre‑annotations for interactive predictions

## Notes
- This is a per‑project configuration. There is no global auto‑connect.
- The `ls-triton-adapter` service is shared and always running in the `apps` namespace.
- The deprecated `ls-ml-autoconnect` service has been removed to avoid coupling infrastructure to user tokens.

## Validation
- In project UI: Settings → Model → Test → should return 200 OK from `/health`
- From a pod: `curl -s http://ls-triton-adapter.apps.svc.cluster.local:9090/health`
