# Enabling NVIDIA GPUs on K3s Worker Nodes

This cluster uses containerd from k3s (`/var/lib/rancher/k3s/agent/...`). To
expose the RTX 4090 on **calypso** to Kubernetes workloads we need two things:

1. The NVIDIA driver and container toolkit packages on the host
2. Containerd configured to use the `nvidia-container-runtime` as the default
   runtime so the device plugin can load NVML inside pods

## 1. Ensure the host packages are present

```bash
# From any admin box with kubeconfig:
k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'chroot /host apt-get update'

k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'chroot /host apt-get install -y nvidia-driver-580-open nvidia-container-toolkit'

# Optional sanity check
k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'chroot /host nvidia-smi || true'
```

## 2. Update containerd to default to the NVIDIA runtime

K3s regenerates `config.toml` from `config.toml.tmpl` on every restart. Copy the
current config to the template and add a `default_runtime_name`:

```bash
k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'cp /host/var/lib/rancher/k3s/agent/etc/containerd/config.toml \
    /host/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl'

# Append the following stanza (before the runc runtime block)
cat <<'EOF' | k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
    bash -lc 'cat >>/host/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl'
[plugins.'io.containerd.cri.v1.runtime'.containerd]
  default_runtime_name = "nvidia"
EOF
```

Alternatively, edit the file manually and ensure the `nvidia` runtime section
exists with `BinaryName = "/usr/bin/nvidia-container-runtime"`.

## 3. Apply config & restart the agent

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor \
    -o /etc/apt/keyrings/nvidia-container-toolkit-keyring.gpg  # if not already done

# Let nvidia-ctk inject runtime stanza and update the config
k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'chroot /host nvidia-ctk runtime configure \
    --runtime=containerd \
    --config=/var/lib/rancher/k3s/agent/etc/containerd/config.toml'

# Restart the agent so containerd picks up the change
k3s kubectl debug node/calypso --image=ubuntu --profile=general -- \
  bash -lc 'chroot /host systemctl restart k3s-agent'
```

## 4. Validate from Kubernetes

```bash
k3s kubectl rollout restart ds/nvidia-device-plugin-daemonset -n kube-system
k3s kubectl wait --for=condition=Ready pod -l name=nvidia-device-plugin-ds -n kube-system

k3s kubectl describe node calypso | grep -A1 nvidia.com/gpu
nvidia.com/gpu:     1
```

If `nvidia-smi` still fails or the plugin logs `could not load NVML`, double
check that the driver packages are installed, `/dev/nvidia*` exists, and that
`config.toml.tmpl` contains the default runtime stanza before restarting the
agent once more.
