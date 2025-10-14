# Manual Calypso K3s Join Procedure

## Context

Calypso (192.168.2.80) is a GPU worker node on a private local network that cannot be reached from GitHub Actions public runners. It must be provisioned manually after the tethys/styx cluster is operational.

This is a **temporary solution** until automated provisioning via Kubernetes Job is implemented (see #114 for roadmap).

---

## Prerequisites

- ✅ Tethys + Styx cluster deployed and operational
- ✅ SSH access to calypso from local network
- ✅ K3s token and master IP available

---

## Step 1: Get K3s Token

From tethys (master node):

```bash
# SSH to tethys
ssh root@157.173.210.123

# Get K3s token
sudo cat /var/lib/rancher/k3s/server/node-token
```

**Example output:**
```
K10abc123def456ghi789jkl012mno345::server:xyz789
```

Save this token for the next step.

---

## Step 2: Join Calypso to Cluster

From calypso (local network):

```bash
# SSH to calypso (requires local network access)
ssh oceanid@192.168.2.80

# Install K3s agent with GPU support
export K3S_TOKEN="<token-from-step-1>"
export K3S_URL="https://157.173.210.123:6443"
export INSTALL_K3S_VERSION="v1.33.4+k3s1"

curl -sfL https://get.k3s.io | sh -s - agent \
  --node-label oceanid.node/name=calypso \
  --node-label oceanid.node/gpu=nvidia-rtx-4090

# Wait for node to join (may take 30-60 seconds)
sleep 60
```

---

## Step 3: Verify Node Joined

From tethys:

```bash
# Check if calypso appears in nodes list
kubectl get nodes -o wide

# Expected output:
# NAME        STATUS   ROLES                       AGE   VERSION          INTERNAL-IP     OS-IMAGE
# srv712429   Ready    control-plane,etcd,master   10m   v1.33.4+k3s1     157.173.210.123 Ubuntu 25.04
# srv712695   Ready    <none>                      8m    v1.33.4+k3s1     191.101.1.3     Ubuntu 25.04
# calypso     Ready    <none>                      1m    v1.33.4+k3s1     192.168.2.80    Ubuntu 22.04

# Verify GPU labels
kubectl get nodes calypso --show-labels | grep gpu
```

---

## Step 4: Configure GPU Runtime (If Needed)

If calypso is not detecting the GPU:

```bash
# SSH to calypso
ssh oceanid@192.168.2.80

# Check if nvidia-container-runtime is installed
which nvidia-container-runtime

# If not installed:
sudo apt-get update
sudo apt-get install -y nvidia-container-runtime

# Configure containerd for GPU
sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd/
sudo tee /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl > /dev/null <<EOF
[plugins.opt]
  path = "/opt/containerd"
[plugins.cri]
  stream_server_address = "127.0.0.1"
  stream_server_port = "10010"
[plugins.cri.containerd.default_runtime]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.nvidia]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.nvidia.options]
  BinaryName = "/usr/bin/nvidia-container-runtime"
EOF

# Restart k3s-agent
sudo systemctl restart k3s-agent

# Verify GPU is available
sudo k3s ctr image pull docker.io/nvidia/cuda:11.0-base
sudo k3s crictl run --runtime=nvidia <test-container>
```

---

## Troubleshooting

### Node Not Joining

```bash
# Check k3s-agent logs on calypso
sudo journalctl -u k3s-agent --since "5 minutes ago" --no-pager

# Common issues:
# - Firewall blocking port 6443
# - Incorrect K3s token
# - Network connectivity to tethys
```

### Node Stuck in NotReady

```bash
# Check node status
kubectl describe node calypso

# Look for:
# - CNI plugin errors
# - Kubelet certificate issues
# - Network policy problems
```

### GPU Not Detected

```bash
# Verify nvidia-smi works
nvidia-smi

# Check if nvidia-container-runtime is installed
dpkg -l | grep nvidia-container

# Verify containerd config
sudo cat /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
```

---

## Future Automation (Roadmap)

**Phase 1 (Current):** Manual join via SSH
**Phase 2 (Planned):** Kubernetes Job provisioner (see #114)

**Implementation Steps:**
1. Create Kubernetes Job that runs on tethys
2. Mount calypso SSH key as secret
3. Job SSHs to calypso (reachable via local network from tethys)
4. Installs K3s agent and joins cluster
5. Self-terminates on success

**Benefits:**
- ✅ Fully automated (no manual SSH)
- ✅ Calypso config version-controlled
- ✅ Repeatable provisioning
- ✅ No drift from IaC

---

## References

- Issue #114: K3s Provisioning Failures (architectural discussion)
- Issue #111: Two-Stack Separation Complete
- K3s Docs: https://docs.k3s.io/installation/configuration
