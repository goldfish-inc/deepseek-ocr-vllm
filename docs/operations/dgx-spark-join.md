# DGX Spark K3s Integration Procedure

**Last updated:** 2025-01-21
**Hardware:** NVIDIA DGX Spark (multi-GPU training workload node)
**Network:** Same LAN as Calypso (192.168.2.x)
**Purpose:** 100% training workload, no inference

---

## Prerequisites

Before starting, verify you have:
- [ ] DGX Spark physical installation complete (racked, powered, network connected)
- [ ] IP address and hostname assigned
- [ ] Initial root/admin credentials
- [ ] Network connectivity to tethys control plane (157.173.210.123:6443)
- [ ] K3s token from tethys control plane

---

## Phase 1: Base System Setup

### 1.1 Get K3s Token from Tethys

```bash
# SSH to tethys control plane
sshpass -p "TaylorRules" ssh -o StrictHostKeyChecking=no root@157.173.210.123

# Retrieve K3s join token
sudo cat /var/lib/rancher/k3s/server/node-token
```

Save this token for Phase 2.

### 1.2 Initial DGX Spark Access

```bash
# SSH to DGX Spark (replace <SPARK_IP> with actual IP)
ssh root@<SPARK_IP>

# Verify NVIDIA DGX OS version
cat /etc/os-release
uname -a

# Check GPU detection
nvidia-smi
```

**Expected output:** All GPUs visible with driver version, CUDA version, utilization 0%

---

## Phase 2: NVIDIA Driver & Container Toolkit (2025 Best Practices)

### 2.1 Install NVIDIA Container Toolkit

```bash
# Add NVIDIA package repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] \
  https://nvidia.github.io/libnvidia-container/stable/deb/$(ARCH) /" | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Install toolkit
apt-get update
apt-get install -y nvidia-container-toolkit

# Verify installation
nvidia-ctk --version
```

### 2.2 Verify CUDA/Driver Compatibility

**CRITICAL:** Match driver version with Calypso for model portability.

```bash
# Check Calypso's CUDA version (from tethys)
sshpass -p "C0w5in$pace" ssh -o StrictHostKeyChecking=no neptune@192.168.2.110 'nvidia-smi'

# On DGX Spark: Ensure CUDA >= Calypso's version
nvidia-smi | grep "CUDA Version"
```

**Required:** DGX Spark CUDA version >= Calypso CUDA version for forward compatibility.

---

## Phase 3: K3s Agent Installation

### 3.1 Join DGX Spark to K3s Cluster

```bash
# On DGX Spark
export K3S_TOKEN="<token-from-phase-1>"
export K3S_URL="https://157.173.210.123:6443"
export INSTALL_K3S_VERSION="v1.33.4+k3s1"

# Install K3s agent with training-specific labels
curl -sfL https://get.k3s.io | sh -s - agent \
  --node-label oceanid.node/name=spark \
  --node-label oceanid.node/gpu=nvidia-dgx-spark \
  --node-label workload-type=training \
  --node-taint workload-type=training:NoSchedule

# Wait for node join (30-60 seconds)
sleep 60
```

**Node labels explained:**
- `oceanid.node/name=spark`: Identifies DGX Spark in cluster
- `oceanid.node/gpu=nvidia-dgx-spark`: GPU hardware type
- `workload-type=training`: Marks node for training workloads only

**Node taint explained:**
- `workload-type=training:NoSchedule`: Prevents non-training pods from scheduling
- Only pods with `tolerations` for this taint can run on DGX Spark

### 3.2 Configure Containerd for GPU Support

```bash
# On DGX Spark
# Configure containerd to use NVIDIA runtime
nvidia-ctk runtime configure \
  --runtime=containerd \
  --config=/var/lib/rancher/k3s/agent/etc/containerd/config.toml

# Set default runtime to NVIDIA
cat <<'EOF' > /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
[plugins.'io.containerd.cri.v1.runtime'.containerd]
  default_runtime_name = "nvidia"

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.nvidia]
  runtime_type = "io.containerd.runc.v2"
[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.nvidia.options]
  BinaryName = "/usr/bin/nvidia-container-runtime"
EOF

# Restart K3s agent to apply changes
systemctl restart k3s-agent
```

---

## Phase 4: Verification

### 4.1 Verify Node Joined Cluster

```bash
# From tethys or local workstation with kubectl
kubectl get nodes -o wide

# Expected output:
# NAME        STATUS   ROLES                       AGE   VERSION
# srv712429   Ready    control-plane,etcd,master   ...   v1.33.4+k3s1
# srv712695   Ready    <none>                      ...   v1.33.4+k3s1
# calypso     Ready    <none>                      ...   v1.33.4+k3s1
# spark       Ready    <none>                      NEW   v1.33.4+k3s1

# Verify node labels
kubectl get node spark --show-labels | grep workload-type

# Verify GPU resources detected
kubectl describe node spark | grep -A5 "Allocatable:"
# Should show: nvidia.com/gpu: <N> (where N = number of GPUs)
```

### 4.2 Verify GPU Runtime

```bash
# Deploy test GPU pod on DGX Spark
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: gpu-test-spark
  namespace: default
spec:
  restartPolicy: Never
  nodeSelector:
    oceanid.node/name: spark
  tolerations:
  - key: workload-type
    operator: Equal
    value: training
    effect: NoSchedule
  containers:
  - name: cuda
    image: nvidia/cuda:12.3.0-base-ubuntu22.04
    command: ["nvidia-smi"]
    resources:
      limits:
        nvidia.com/gpu: 1
EOF

# Wait for completion
kubectl wait --for=condition=Completed pod/gpu-test-spark --timeout=120s

# Check logs for GPU detection
kubectl logs gpu-test-spark

# Cleanup
kubectl delete pod gpu-test-spark
```

**Expected:** `nvidia-smi` output showing GPU info, driver version, CUDA version.

---

## Phase 5: Tailscale Integration

### 5.1 Install Tailscale on DGX Spark

```bash
# On DGX Spark
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate (requires browser or auth key)
tailscale up

# Verify Tailscale IP assigned
tailscale ip -4
```

### 5.2 Update Tailscale ACLs (if needed)

Add DGX Spark to Tailscale ACL allowlist for cluster communication:

```json
{
  "hosts": {
    "spark": "<TAILSCALE_IP>"
  },
  "acls": [
    {
      "action": "accept",
      "src": ["spark"],
      "dst": ["tethys:*", "calypso:*"]
    }
  ]
}
```

---

## Phase 6: Storage Configuration

### 6.1 Mount Calypso Storage for Datasets

**Option A: NFS Mount (recommended for shared datasets)**

```bash
# On Calypso: Set up NFS export
sshpass -p "C0w5in$pace" ssh neptune@192.168.2.110 <<'EOF'
sudo apt-get install -y nfs-kernel-server
sudo mkdir -p /exports/datasets
sudo chown neptune:neptune /exports/datasets

# Export to DGX Spark (replace <SPARK_IP>)
echo "/exports/datasets <SPARK_IP>(rw,sync,no_subtree_check,no_root_squash)" | \
  sudo tee -a /etc/exports

sudo exportfs -a
sudo systemctl restart nfs-kernel-server
EOF

# On DGX Spark: Mount NFS share
apt-get install -y nfs-common
mkdir -p /mnt/calypso-datasets
mount -t nfs 192.168.2.110:/exports/datasets /mnt/calypso-datasets

# Add to /etc/fstab for persistence
echo "192.168.2.110:/exports/datasets /mnt/calypso-datasets nfs defaults 0 0" >> /etc/fstab

# Verify mount
df -h /mnt/calypso-datasets
```

**Option B: S3-compatible storage (for cloud-native workflows)**

```bash
# Install AWS CLI or MinIO client
apt-get install -y awscli

# Configure S3 credentials from Pulumi ESC
# (Retrieve from: pulumi config get awsAccessKeyId)
aws configure set aws_access_key_id "<KEY>"
aws configure set aws_secret_access_key "<SECRET>"
aws configure set region us-east-1

# Test S3 access
aws s3 ls s3://oceanid-datasets/
```

---

## Phase 7: Monitoring Setup

### 7.1 Deploy DCGM Exporter for GPU Metrics

```bash
# Create namespace for monitoring
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -

# Deploy DCGM Exporter as DaemonSet (GPU nodes only)
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: dcgm-exporter
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: dcgm-exporter
  template:
    metadata:
      labels:
        app: dcgm-exporter
    spec:
      nodeSelector:
        workload-type: training
      tolerations:
      - key: workload-type
        operator: Equal
        value: training
        effect: NoSchedule
      containers:
      - name: dcgm-exporter
        image: nvcr.io/nvidia/k8s/dcgm-exporter:3.3.5-3.4.1-ubuntu22.04
        securityContext:
          runAsNonRoot: false
          runAsUser: 0
          capabilities:
            add: ["SYS_ADMIN"]
        volumeMounts:
        - name: pod-gpu-resources
          readOnly: true
          mountPath: /var/lib/kubelet/pod-resources
        ports:
        - name: metrics
          containerPort: 9400
        env:
        - name: DCGM_EXPORTER_LISTEN
          value: ":9400"
        - name: DCGM_EXPORTER_KUBERNETES
          value: "true"
      volumes:
      - name: pod-gpu-resources
        hostPath:
          path: /var/lib/kubelet/pod-resources
---
apiVersion: v1
kind: Service
metadata:
  name: dcgm-exporter
  namespace: monitoring
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9400"
spec:
  type: ClusterIP
  selector:
    app: dcgm-exporter
  ports:
  - name: metrics
    port: 9400
    targetPort: 9400
EOF

# Verify DCGM Exporter running
kubectl -n monitoring get pods -l app=dcgm-exporter
kubectl -n monitoring logs -l app=dcgm-exporter --tail=20
```

### 7.2 Configure Grafana Cloud Scrape (via Prometheus)

Add DCGM Exporter to Prometheus scrape config (managed via Pulumi/Flux):

```yaml
# cluster/apps/monitoring/prometheus-config.yaml
scrape_configs:
- job_name: 'dcgm-exporter-spark'
  kubernetes_sd_configs:
  - role: service
    namespaces:
      names: ['monitoring']
  relabel_configs:
  - source_labels: [__meta_kubernetes_service_name]
    action: keep
    regex: dcgm-exporter
  - source_labels: [__meta_kubernetes_pod_node_name]
    target_label: node
```

---

## Phase 8: Initial Training Job Validation

### 8.1 Deploy Test Training Job

```bash
# Create test training job (PyTorch example)
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: training-validation-spark
  namespace: apps
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        workload-type: training
    spec:
      restartPolicy: Never
      nodeSelector:
        oceanid.node/name: spark
      tolerations:
      - key: workload-type
        operator: Equal
        value: training
        effect: NoSchedule
      containers:
      - name: pytorch-test
        image: pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime
        command:
        - python3
        - -c
        - |
          import torch
          print(f"PyTorch version: {torch.__version__}")
          print(f"CUDA available: {torch.cuda.is_available()}")
          print(f"CUDA version: {torch.version.cuda}")
          print(f"GPU count: {torch.cuda.device_count()}")
          for i in range(torch.cuda.device_count()):
              print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
          # Simple tensor operation on GPU
          x = torch.randn(1000, 1000).cuda()
          y = torch.randn(1000, 1000).cuda()
          z = torch.matmul(x, y)
          print(f"GPU computation successful: {z.shape}")
        resources:
          limits:
            nvidia.com/gpu: 1
EOF

# Wait for job completion
kubectl wait --for=condition=complete --timeout=300s job/training-validation-spark -n apps

# Check logs
kubectl logs -n apps job/training-validation-spark

# Expected output:
# PyTorch version: 2.1.0
# CUDA available: True
# CUDA version: 12.1
# GPU count: <N>
# GPU 0: <GPU_MODEL>
# GPU computation successful: torch.Size([1000, 1000])

# Cleanup
kubectl delete job training-validation-spark -n apps
```

---

## Success Criteria

Before marking DGX Spark integration complete, verify:

- [x] Node appears in `kubectl get nodes` with Ready status
- [x] Node labels include `workload-type=training`
- [x] Node taints prevent non-training pods from scheduling
- [x] `nvidia.com/gpu` resources show correct GPU count
- [x] Test GPU pod runs successfully and detects GPUs
- [x] Tailscale IP assigned and cluster communication works
- [x] Calypso storage mounted and accessible
- [x] DCGM Exporter running and exposing metrics
- [x] Test training job completes successfully on DGX Spark

---

## Troubleshooting

### Issue: Node shows NotReady

```bash
# Check K3s agent status
systemctl status k3s-agent

# Check kubelet logs
journalctl -u k3s-agent -n 100

# Common fix: Restart agent
systemctl restart k3s-agent
```

### Issue: GPUs not detected (`nvidia.com/gpu: 0`)

```bash
# Verify NVIDIA driver loaded
nvidia-smi

# Check containerd config
cat /var/lib/rancher/k3s/agent/etc/containerd/config.toml | grep nvidia

# Verify NVIDIA runtime exists
nvidia-ctk --version
nvidia-container-runtime --version

# Restart agent after config fix
systemctl restart k3s-agent
```

### Issue: Training pods stuck in Pending

```bash
# Check pod events
kubectl describe pod <POD_NAME> -n apps

# Common causes:
# - Missing tolerations for training taint
# - GPU resources exhausted
# - Node selector mismatch

# Verify node selector and tolerations:
kubectl get pod <POD_NAME> -n apps -o yaml | grep -A10 "nodeSelector:\|tolerations:"
```

### Issue: NFS mount fails

```bash
# On Calypso: Verify NFS server running
systemctl status nfs-kernel-server

# Check exports
showmount -e 192.168.2.110

# On DGX Spark: Test mount manually
mount -v -t nfs 192.168.2.110:/exports/datasets /mnt/test
```

---

## Next Steps

1. **Deploy production training workloads** (NER fine-tuning, Docling adaptation)
2. **Configure Kubernetes Job templates** for common training tasks
3. **Set up model registry** for promoting models from DGX Spark → Calypso Triton
4. **Create training pipeline automation** (Argo Workflows or Airflow)
5. **Document GPU utilization metrics** in Grafana Cloud dashboards

---

## References

- [DGX Spark Integration Plan](../workplans/dgx-spark-integration.md)
- [GPU Runtime Configuration](./gpu-runtime.md)
- [Calypso K3s Join Procedure](./manual-calypso-join.md)
- [Cluster Networking](./networking.md)
- [NVIDIA Container Toolkit Docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
- [K3s Agent Configuration](https://docs.k3s.io/installation/configuration)
