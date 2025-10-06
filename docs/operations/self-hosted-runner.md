# GitHub Self‑Hosted Runner (Cluster Stack)

Purpose: run `pulumi up` for `cluster/` on a host with kubeconfig (e.g., tethys) using a GitHub Actions self‑hosted runner. This enables automated applies without exposing the K3s API publicly or tunneling from GitHub runners.

## Prerequisites
- Host with kubeconfig access to K3s (verify `kubectl get nodes` works)
- GitHub repository admin permissions (to register a runner)
- Pulumi access token and stack passphrase in GitHub Secrets

## Install Runner (on tethys)

1) Create a runner in GitHub:
- Repo → Settings → Actions → Runners → New self‑hosted runner
- Choose Linux → x64 and follow the provided commands

2) Install as a service (from runner directory):
```bash
sudo ./svc.sh install
sudo ./svc.sh start
./svc.sh status
```

3) Verify connectivity:
- GitHub → Actions → Runners should show the runner as Online with label `self-hosted`

## Secrets Required (Repository)
- `PULUMI_ACCESS_TOKEN` – Pulumi Cloud access token
- `PULUMI_CONFIG_PASSPHRASE` – Passphrase for the cluster stack

Optional: If kubeconfig is not under the default path used by the stack, ensure the runner user has access or export `KUBECONFIG` in the runner service environment.

## Workflow
- The workflow `.github/workflows/cluster-selfhosted.yml` runs on push to `main` for `cluster/**` changes and uses the self‑hosted runner to execute `pulumi up`.

## Troubleshooting
- Runner offline: check `./svc.sh status` and system logs
- Pulumi errors: ensure both secrets are configured and valid
- Kubeconfig: confirm file path and permissions for the runner user

