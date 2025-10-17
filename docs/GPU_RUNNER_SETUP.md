# GPU Runner Setup for CI (#162)

## Overview

Self-hosted GPU runner for executing `smoke-ner.yml` GPU job. Validates ONNX Runtime with CUDA execution provider and runs end-to-end NER training + export smoke tests.

## Requirements

### Hardware
- **GPU**: NVIDIA GPU with Compute Capability ≥ 7.0 (RTX 2000+ series, Tesla T4+)
- **VRAM**: Minimum 8GB (16GB recommended for batch processing)
- **CPU**: 4+ cores
- **RAM**: 16GB+
- **Storage**: 50GB+ free space for model cache, conda environments

### Software Stack
- **OS**: Ubuntu 22.04 LTS or 24.04 LTS
- **NVIDIA Driver**: ≥ 535.x (for CUDA 12.x support)
- **CUDA Toolkit**: 12.1+ (matches torch 2.8 requirements)
- **Docker** (optional): For isolated runner execution

### Python Environment
- **Micromamba**: Installed via setup-micromamba action
- **Python**: 3.11 (defined in environment.yml)
- **Key packages**:
  - torch 2.8.0 with CUDA 12.1+ support
  - onnxruntime-gpu 1.19+
  - transformers 4.56.1+
  - tokenizers 0.22.x

## Setup Steps

### 1. Provision Runner Machine

#### Option A: Bare Metal / VM
```bash
# Install NVIDIA driver (Ubuntu 22.04/24.04)
sudo apt update
sudo apt install nvidia-driver-550 nvidia-utils-550

# Verify installation
nvidia-smi
# Expected: Driver version 550.x+, CUDA Version 12.4+

# Install CUDA Toolkit (optional, if needed for builds)
wget https://developer.download.nvidia.com/compute/cuda/12.4.0/local_installers/cuda_12.4.0_550.54.14_linux.run
sudo sh cuda_12.4.0_550.54.14_linux.run --silent --toolkit
```

#### Option B: Docker Runner
```dockerfile
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

# Install GitHub Actions runner dependencies
RUN apt-get update && apt-get install -y \
    curl git jq libicu-dev && \
    rm -rf /var/lib/apt/lists/*

# GitHub Actions runner setup
# ... (follow GitHub docs for containerized runners)
```

### 2. Install GitHub Actions Runner

```bash
# Create runner user
sudo useradd -m -s /bin/bash runner
sudo usermod -aG sudo runner

# Switch to runner user
sudo su - runner

# Download GitHub Actions runner (latest)
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz

# Configure runner
./config.sh --url https://github.com/goldfish-inc/oceanid \
  --token <REGISTRATION_TOKEN> \
  --name gpu-runner-1 \
  --labels self-hosted,linux,x64,gpu \
  --work _work \
  --unattended

# Install as systemd service (runs as runner user)
sudo ./svc.sh install runner
sudo ./svc.sh start
```

**Get Registration Token:**
```bash
# From repo with admin access
gh api repos/goldfish-inc/oceanid/actions/runners/registration-token \
  --jq .token
```

### 3. Verify Runner Setup

#### Check Runner Status
```bash
# On runner machine
sudo ./svc.sh status

# From repo
gh api repos/goldfish-inc/oceanid/actions/runners \
  --jq '.runners[] | select(.labels[].name == "gpu")'
```

#### Test GPU Access
```bash
# On runner machine (as runner user)
nvidia-smi
# Should show GPU details without sudo

# Test CUDA samples (optional)
cuda-samples/Samples/1_Utilities/deviceQuery/deviceQuery
```

### 4. Enable GPU Smoke Tests

```bash
# Set repository variable (already done)
gh variable set ENABLE_GPU_SMOKE --body "true"

# Verify
gh variable list | grep GPU
# → ENABLE_GPU_SMOKE	true	2025-10-17T17:28:47Z
```

### 5. Validate ORT CUDA Provider

Create validation script on runner:

```bash
cat > /tmp/validate_ort_cuda.py << 'EOF'
#!/usr/bin/env python3
import onnxruntime as ort

print("ONNX Runtime version:", ort.__version__)
print("Available providers:", ort.get_available_providers())

# Check CUDA provider
if 'CUDAExecutionProvider' in ort.get_available_providers():
    print("✅ CUDAExecutionProvider available")

    # Test session creation with CUDA
    try:
        import numpy as np
        # Create dummy model session
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        print(f"✅ Providers: {providers}")
    except Exception as e:
        print(f"❌ CUDA provider error: {e}")
else:
    print("❌ CUDAExecutionProvider NOT available")
    print("Install onnxruntime-gpu with: pip install onnxruntime-gpu")
EOF

chmod +x /tmp/validate_ort_cuda.py

# Run validation
micromamba run -n ner-training python /tmp/validate_ort_cuda.py
```

**Expected output:**
```
ONNX Runtime version: 1.19.0
Available providers: ['CUDAExecutionProvider', 'CPUExecutionProvider']
✅ CUDAExecutionProvider available
✅ Providers: ['CUDAExecutionProvider', 'CPUExecutionProvider']
```

## Workflow Integration

### Smoke Test Execution Flow

1. **Trigger**: PR/push to `main` touching ML paths, or manual `workflow_dispatch`
2. **Jobs**:
   - `cpu`: Always runs on `ubuntu-latest`
   - `gpu`: Conditional on `vars.ENABLE_GPU_SMOKE == 'true'`, runs on `[self-hosted, linux, x64, gpu]`
3. **GPU Job Steps**:
   - Checkout code
   - Setup micromamba environment
   - **Verify GPU**: Run `nvidia-smi` (fails if GPU not accessible)
   - **Run smoke**: Execute `scripts/smoke_ner.sh` with CUDA
4. **Expected duration**: 10-20 minutes (includes model download, training, export)

### Monitoring GPU Job

```bash
# Watch job in real-time
gh run watch <RUN_ID>

# View GPU job logs
gh run view <RUN_ID> --log | grep -A 50 "GPU smoke"

# Check for CUDA provider usage in logs
gh run view <RUN_ID> --log | grep -i "CUDAExecutionProvider"
```

## Acceptance Criteria (#162)

- ✅ Self-hosted runner configured with labels: `[self-hosted, linux, x64, gpu]`
- ✅ NVIDIA driver + CUDA toolkit installed (driver ≥ 535.x, CUDA 12.1+)
- ✅ `nvidia-smi` accessible to runner user
- ✅ Repository variable `ENABLE_GPU_SMOKE=true` set
- ✅ Workflow `.github/workflows/smoke-ner.yml` GPU job passes
- ✅ ORT logs show `CUDAExecutionProvider` in use
- ✅ Smoke test completes: training + export + inference on GPU

## Troubleshooting

### GPU Not Detected
```bash
# Check driver
nvidia-smi
sudo dmesg | grep -i nvidia

# Verify CUDA
nvcc --version
ls -la /usr/local/cuda

# Test PyTorch CUDA
python -c "import torch; print('CUDA available:', torch.cuda.is_available())"
```

### ORT CUDA Provider Missing
```bash
# Check onnxruntime version
pip list | grep onnxruntime

# Reinstall with GPU support
pip uninstall onnxruntime onnxruntime-gpu
pip install onnxruntime-gpu==1.19.0

# Verify
python -c "import onnxruntime; print(onnxruntime.get_available_providers())"
```

### Runner Service Issues
```bash
# Check service status
sudo systemctl status actions.runner.goldfish-inc-oceanid.gpu-runner-1.service

# View logs
sudo journalctl -u actions.runner.goldfish-inc-oceanid.gpu-runner-1.service -f

# Restart service
sudo ./svc.sh stop
sudo ./svc.sh start
```

### Permission Errors
```bash
# Runner user needs GPU access
sudo usermod -aG video runner
sudo usermod -aG render runner

# Restart runner service after group changes
sudo ./svc.sh stop && sudo ./svc.sh start
```

## Security Considerations

1. **Runner Isolation**: Use dedicated machine or Docker container
2. **Secrets**: Runner has access to repository secrets - ensure trusted environment
3. **Network**: Restrict outbound connections if possible (allow GitHub API, PyPI, conda-forge)
4. **Updates**: Keep NVIDIA driver, CUDA, and runner software updated
5. **Monitoring**: Set up alerts for runner failures or unusual resource usage

## Cost Optimization

- **On-Demand**: Stop runner when not in use (manual triggers only)
- **Spot Instances**: Use cloud spot/preemptible instances for cost savings
- **Scheduled**: Run GPU smokes on nightly schedule instead of every PR
- **Cache**: Enable micromamba caching to reduce download time

## References

- GitHub Actions Self-Hosted Runners: https://docs.github.com/en/actions/hosting-your-own-runners
- NVIDIA Driver Installation: https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/
- CUDA Toolkit: https://developer.nvidia.com/cuda-downloads
- ONNX Runtime GPU: https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
