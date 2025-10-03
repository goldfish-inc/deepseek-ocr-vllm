# Pulumi Deployments Agent (Cluster Stack)

Purpose: run `pulumi up` for `cluster/` inside your network using a self‑hosted agent, so Git pushes trigger safe, audited applies without exposing kubeconfig to GitHub runners.

## Prerequisites
- Host with kubeconfig access to the K3s cluster (e.g., tethys)
- Pulumi Cloud organization and an agent token
- Outbound Internet for the agent to reach Pulumi Cloud

## Install Agent

```bash
# On the host with kubeconfig
curl -fsSL https://get.pulumi.com/install.sh | sh  # if Pulumi CLI not present

# Register agent to pool "oceanid-cluster"
pulumi deployments agent install \
  --token "<PULUMI_AGENT_TOKEN>" \
  --pool oceanid-cluster

# Enable at boot
sudo systemctl enable pulumi-deployments-agent
sudo systemctl start pulumi-deployments-agent

# Verify
systemctl status pulumi-deployments-agent --no-pager
```

Systemd unit will be installed under `pulumi-deployments-agent.service`. Ensure the process runs as a user that can read kubeconfig (or export `KUBECONFIG` in the unit if needed).

## Pulumi Cloud Configuration
- Stack: `ryan-taylor/oceanid-cluster/prod`
- Enable Deployments
- Deployment pool: `oceanid-cluster`
- Trigger: push to `main`
- Work directory: `cluster/`

## Config Flags
- `enableLsProvisionerJob`: gate the LS one‑off provisioner. Set `false` to disable.
- `enableLsVerifyJob`: gate the LS verification job. Set `false` to disable.

Set config via Pulumi:
```bash
pulumi -C cluster config set enableLsProvisionerJob false
pulumi -C cluster config set enableLsVerifyJob false
```

## Troubleshooting
- Agent offline: check systemd status and outbound network.
- Kubeconfig: ensure the agent user has access; export `KUBECONFIG` if not default.
- Stuck runs: view logs in Pulumi Cloud → Deployments → Runs; fix config or secrets in ESC and re‑run.

