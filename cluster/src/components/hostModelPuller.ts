import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostModelPullerArgs {
  host: string;
  user: string;
  privateKey: pulumi.Input<string>;
  hfToken: pulumi.Input<string>;
  hfModelRepo?: pulumi.Input<string>; // e.g., goldfish-inc/oceanid-ner-distilbert
  targetDir?: pulumi.Input<string>;   // e.g., /opt/triton/models/distilbert-base-uncased
  interval?: pulumi.Input<string>;    // systemd OnCalendar or OnUnitActiveSec, default: 15min
}

export class HostModelPuller extends pulumi.ComponentResource {
  constructor(name: string, args: HostModelPullerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:compute:HostModelPuller", name, {}, opts);

    const { host, user, privateKey, hfToken, hfModelRepo = "goldfish-inc/oceanid-ner-distilbert", targetDir = "/opt/triton/models/distilbert-base-uncased", interval = "15min" } = args;

    const setup = new command.remote.Command(`${name}-install`, {
      connection: { host, user, privateKey },
      create: pulumi.all([hfToken, hfModelRepo, targetDir, interval]).apply(([token, repo, tdir, itv]) => `
set -euo pipefail
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

$SUDO mkdir -p /usr/local/bin ${tdir}
echo '${token}' | $SUDO tee /etc/oceanid.hf.token >/dev/null

cat > /tmp/oceanid-model-pull.py <<'PY'
import os, sys, shutil, json
from pathlib import Path
from datetime import datetime
from huggingface_hub import HfApi, hf_hub_download

HF_TOKEN = Path('/etc/oceanid.hf.token').read_text().strip()
HF_REPO = os.environ.get('HF_MODEL_REPO', 'goldfish-inc/oceanid-ner-distilbert')
TARGET_DIR = Path(os.environ.get('TARGET_DIR', '/opt/triton/models/distilbert-base-uncased'))
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

# Download model.onnx to temp
tmp_path = hf_hub_download(HF_REPO, filename='onnx/model.onnx', repo_type='model', token=HF_TOKEN)

# Determine next numeric version
versions = [int(p.name) for p in TARGET_DIR.iterdir() if p.is_dir() and p.name.isdigit()]
next_ver = (max(versions) + 1) if versions else 1
ver_dir = TARGET_DIR / str(next_ver)
ver_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(tmp_path, ver_dir / 'model.onnx')

# Write sha marker
for p in TARGET_DIR.glob('.sha_*'):
    try: p.unlink()
    except: pass
sha_marker.write_text(sha)
print('Installed model to', ver_dir, 'sha', sha)
PY

$SUDO install -m 0755 /tmp/oceanid-model-pull.py /usr/local/bin/oceanid-model-pull.py

cat > /tmp/oceanid-model-puller.service <<SVC
[Unit]
Description=Oceanid NER Model Puller
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=HF_MODEL_REPO=${repo}
Environment=TARGET_DIR=${tdir}
ExecStart=/usr/bin/env python3 /usr/local/bin/oceanid-model-pull.py
SVC

cat > /tmp/oceanid-model-puller.timer <<SVC
[Unit]
Description=Run Oceanid Model Puller periodically

[Timer]
OnUnitActiveSec=${itv}
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
SVC

$SUDO mv /tmp/oceanid-model-puller.service /etc/systemd/system/oceanid-model-puller.service
$SUDO mv /tmp/oceanid-model-puller.timer /etc/systemd/system/oceanid-model-puller.timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now oceanid-model-puller.timer
$SUDO systemctl start oceanid-model-puller.service || true
`),
    }, { parent: this, customTimeouts: { create: "10m", update: "10m" } });

    this.registerOutputs({});
  }
}

