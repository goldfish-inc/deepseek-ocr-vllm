import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostModelPullerArgs {
  host: string;
  user: string;
  privateKey: pulumi.Input<string>;
  hfToken: pulumi.Input<string>;
  hfModelRepo?: pulumi.Input<string>; // e.g., distilbert/distilbert-base-uncased
  targetDir?: pulumi.Input<string>;   // e.g., /opt/triton/models/distilbert-base-uncased
  interval?: pulumi.Input<string>;    // systemd OnCalendar or OnUnitActiveSec, default: 15min
  modelType?: pulumi.Input<string>;   // 'onnx' or 'pytorch' - determines which files to download
}

export class HostModelPuller extends pulumi.ComponentResource {
  constructor(name: string, args: HostModelPullerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:compute:HostModelPuller", name, {}, opts);

    const { host, user, privateKey, hfToken, hfModelRepo = "distilbert/distilbert-base-uncased", targetDir = "/opt/triton/models/distilbert-base-uncased", interval = "15min", modelType = "onnx" } = args;

    const setup = new command.remote.Command(`${name}-install`, {
      connection: { host, user, privateKey },
      create: pulumi.all([hfToken, hfModelRepo, targetDir, interval, modelType]).apply(([token, repo, tdir, itv, mtype]) => {
        // Use unique service name: calypso-distilbert-puller -> calypso-model-puller-distilbert
        const serviceName = name.replace('puller', 'model-puller');
        return `
set -euo pipefail
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

$SUDO mkdir -p /usr/local/bin ${tdir}
echo '${token}' | $SUDO tee /etc/oceanid.hf.token >/dev/null

cat > /tmp/oceanid-model-pull.py <<'PY'
import os, sys, shutil, json
from pathlib import Path
from datetime import datetime
from huggingface_hub import HfApi, snapshot_download

HF_TOKEN = Path('/etc/oceanid.hf.token').read_text().strip()
HF_REPO = os.environ.get('HF_MODEL_REPO', 'distilbert/distilbert-base-uncased')
TARGET_DIR = Path(os.environ.get('TARGET_DIR', '/opt/triton/models/distilbert-base-uncased'))
MODEL_TYPE = os.environ.get('MODEL_TYPE', 'onnx')  # 'onnx' or 'pytorch'
api = HfApi(token=HF_TOKEN)

info = api.repo_info(HF_REPO, repo_type='model')
sha = getattr(info, 'sha', None)
if not sha:
    print('No repo sha found; skipping')
    sys.exit(0)

# If a version directory already exists with this sha marker, skip
sha_marker = TARGET_DIR / f'.sha_{sha}'
if sha_marker.exists():
    print('Model already at latest sha:', sha)
    sys.exit(0)

# Determine next numeric version
versions = [int(p.name) for p in TARGET_DIR.iterdir() if p.is_dir() and p.name.isdigit()]
next_ver = (max(versions) + 1) if versions else 1
ver_dir = TARGET_DIR / str(next_ver)
ver_dir.mkdir(parents=True, exist_ok=True)

if MODEL_TYPE == 'onnx':
    # Download only ONNX model file
    from huggingface_hub import hf_hub_download
    tmp_path = hf_hub_download(HF_REPO, filename='onnx/model.onnx', repo_type='model', token=HF_TOKEN)
    shutil.copy2(tmp_path, ver_dir / 'model.onnx')
    print(f'Downloaded ONNX model to {ver_dir}')
elif MODEL_TYPE == 'pytorch':
    # Download entire model snapshot (PyTorch weights, config, tokenizer, etc.)
    snapshot_download(
        HF_REPO,
        local_dir=str(ver_dir),
        token=HF_TOKEN,
        ignore_patterns=['*.onnx', '*.msgpack']  # Skip ONNX/other formats
    )
    print(f'Downloaded PyTorch model snapshot to {ver_dir}')
else:
    print(f'Unknown MODEL_TYPE: {MODEL_TYPE}')
    sys.exit(1)

# Write sha marker
for p in TARGET_DIR.glob('.sha_*'):
    try: p.unlink()
    except: pass
sha_marker.write_text(sha)
print('Installed model to', ver_dir, 'sha', sha)
PY

$SUDO install -m 0755 /tmp/oceanid-model-pull.py /usr/local/bin/oceanid-model-pull.py

cat > /tmp/${serviceName}.service <<SVC
[Unit]
Description=Oceanid Model Puller (${repo})
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=HF_MODEL_REPO=${repo}
Environment=TARGET_DIR=${tdir}
Environment=MODEL_TYPE=${mtype}
ExecStart=/usr/bin/env python3 /usr/local/bin/oceanid-model-pull.py
SVC

cat > /tmp/${serviceName}.timer <<SVC
[Unit]
Description=Run Oceanid Model Puller periodically for ${repo}

[Timer]
OnUnitActiveSec=${itv}
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
SVC

$SUDO mv /tmp/${serviceName}.service /etc/systemd/system/${serviceName}.service
$SUDO mv /tmp/${serviceName}.timer /etc/systemd/system/${serviceName}.timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now ${serviceName}.timer
$SUDO systemctl start ${serviceName}.service || true
`;
      }),
    }, { parent: this, customTimeouts: { create: "10m", update: "10m" } });

    this.registerOutputs({});
  }
}
