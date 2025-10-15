Grafana Cloud Integration (ESC + Dashboards)

Overview
- We use Grafana Cloud to visualize Prometheus metrics from Oceanid services.
- Credentials are stored in Pulumi ESC and used by a GitHub Action to publish dashboards to your Grafana stack.

ESC Keys (required)
- `pulumiConfig.oceanid-cluster:grafana.url` — your Grafana stack URL, e.g. `https://oceanid.grafana.net`
- `pulumiConfig.oceanid-cluster:grafana.accessPolicyId` — access policy ID (for audit/reference)
- `pulumiConfig.oceanid-cluster:grafana.token` — access policy token with `dashboards:write` (store as secret)

Set values:

```bash
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:grafana.url "https://<stack>.grafana.net"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:grafana.accessPolicyId "ab19c8ea-4637-4041-a196-025d070d15fe"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:grafana.token "<access_policy_token>" --secret
```

Publish Dashboard
- Workflow: `Publish Grafana Dashboard` (manual)
- Default file: `dashboards/oceanid-sink.json`

The workflow fetches ESC keys and POSTs the dashboard to `POST ${grafana.url}/api/dashboards/db` with bearer token.

Included Panels (oceanid-sink.json)
- Webhooks valid/invalid (sink_webhooks_total)
- Enqueue results by repo/task (sink_enqueue_total)
- Outbox commits by repo/status (sink_outbox_commits_total)
- Outbox records processed/failed (sink_outbox_records_*_total)

Notes
- Ensure Grafana access policy token has `dashboards:write` scope for your org/stack.
- Metrics must be available to Grafana (via Prometheus data source or Grafana Cloud Agent remote_write).
