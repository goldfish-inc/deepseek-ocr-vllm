# Operations Guide

This guide covers the day‑to‑day flows for the Oceanid stack with 2× VPS and 1× GPU workstation.

## Topology
- K8s on primary VPS (tethys). Label Studio runs here and is exposed via the Cloudflare cluster tunnel at `https://label.boathou.se`.
- Calypso (GPU workstation) runs a host‑level cloudflared connector and a simple GPU HTTP service at `https://gpu.boathou.se`.
- All secrets and tokens are stored in Pulumi ESC (`default/oceanid-cluster`).

## Deploy
- Minimal, non‑disruptive deploy:
  - `make deploy-simple`
- Full deploy (enable provisioning + LB) once tunnels are stable:
  - `pulumi config set oceanid-cluster:enableNodeProvisioning true`
  - `pulumi config set oceanid-cluster:enableControlPlaneLB true`
  - `pulumi up`

## Validate
- If kubectl is flaky, ensure a local API tunnel:
  - `scripts/k3s-ssh-tunnel.sh tethys`
  - `export KUBECONFIG=cluster/kubeconfig.yaml`
- Basic smoke tests:
  - `make smoke` (uses label.boathou.se and gpu.boathou.se)
  - Triton HTTP V2 live:
    - `curl -s https://gpu.boathou.se/v2/health/ready`
    - `curl -s https://gpu.boathou.se/v2/models`
- Check connector health in Cloudflare Zero Trust → Tunnels.

## Secrets & Config
- ESC keys to verify:
  - `cloudflareNodeTunnelId`, `cloudflareNodeTunnelToken`, `cloudflareNodeTunnelHostname`, `cloudflareNodeTunnelTarget`
  - `cloudflareAccountId`, `cloudflareApiToken`, `cloudflareZoneId`
- The node tunnel token can be either:
  - Base64‑encoded credentials.json, or
  - Raw TUNNEL_TOKEN string
  The NodeTunnels + HostCloudflared components auto‑detect both.

## Troubleshooting
- Cloudflare record exists: delete the existing DNS record (e.g., `label.boathou.se`) or remove Pulumi management for that hostname.
- cloudflared “control stream failure”:
  - Ensure `protocol: auto` and `dnsPolicy: ClusterFirstWithHostNet` are active.
  - Verify Calypso has the label `oceanid.cluster/tunnel-enabled=true` if using the K8s DaemonSet.
- SSH provisioning timeouts:
  - Keep `enableNodeProvisioning=false` while stabilizing tunnels.
- Calypso sudo:
  - `oceanid` must have passwordless sudo for apt/systemd.

## Add a new GPU host (host‑level)
1. Provision SSH user + key; add to ESC.
2. Add a `HostCloudflared` + optional `HostGpuService` for the host.
3. Point a new `gpuX.<base>` route via Cloudflare DNS.

## Using Triton with Docling/Granite
- If you have a ready Docker image (e.g., a Docling‑Granite HTTP server), you can run it instead of Triton. Ask and we’ll switch the host service to that container and route `gpu.<base>` to its HTTP port.
- To use a model with Triton, place it under `/opt/triton/models/<model>/1/` on Calypso and add a `config.pbtxt`. Triton supports TensorRT, ONNX, PyTorch, TensorFlow and Python backends.
- If your “docling‑granite” asset is a Python or Torch model, we can wrap it via Triton’s Python backend. This repo includes a skeleton at `triton-models/dockling-granite-python/`. Copy it to Calypso and customize model loading in `model.py`.

Example (on Calypso):

```bash
sudo mkdir -p /opt/triton/models
scp -r triton-models/dockling-granite-python calypso:/tmp/
ssh calypso "sudo mv /tmp/dockling-granite-python /opt/triton/models/dockling_granite && sudo systemctl restart tritonserver"
curl -s https://gpu.<base>/v2/models
```
