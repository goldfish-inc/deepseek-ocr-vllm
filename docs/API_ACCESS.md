Cloudflare Access for Kubernetes API

Overview

- Exposes the cluster API at `api.<base>` via the node tunnel and protects it with Cloudflare Access.
- Use `cloudflared access tcp` locally to open a client tunnel and point kubectl at 127.0.0.1:6443.

Prerequisites

- Your email domain or address is allowed in the Access policy.
- `cloudflared` installed locally and logged in to your Cloudflare account.

Usage

1) Start client tunnel
   cloudflared access tcp --hostname API.<base> --url 127.0.0.1:6443 &

2) Use kubeconfig
   export KUBECONFIG=~/.kube/K3s-config.yaml
   kubectl cluster-info

Notes

- The node tunnel maps `api.<base>` to `https://kubernetes.default.svc.cluster.local:443`.
- DNS is managed by this stack: `api.<base>` CNAME → `<NODE_TUNNEL_ID>.cfargotunnel.com`.
- If you prefer SSH for short sessions, `scripts/k3s-ssh-tunnel.sh` remains available.
