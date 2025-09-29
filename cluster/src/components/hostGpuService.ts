import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostGpuServiceArgs {
    host: string;
    user: string;
    privateKey: pulumi.Input<string>;
    port?: number; // default 9400
}

export class HostGpuService extends pulumi.ComponentResource {
    public readonly serviceReady: pulumi.Output<boolean>;

    constructor(name: string, args: HostGpuServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:compute:HostGpuService", name, {}, opts);

        const { host, user, privateKey, port = 9400 } = args;

        const setup = new command.remote.Command(`${name}-setup`, {
            connection: { host, user, privateKey },
            create: `
set -euo pipefail

APP_DIR=/opt/gpu-service
PY=${process.env.PYTHON || 'python3'}

SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

$SUDO apt-get update -y >/dev/null 2>&1 || true
$SUDO apt-get install -y python3 python3-venv python3-pip >/dev/null 2>&1 || true

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ ! -d venv ]; then
  ${process.env.PYTHON || 'python3'} -m venv venv
fi
. venv/bin/activate
pip install --upgrade pip >/dev/null 2>&1
pip install fastapi uvicorn[standard] >/dev/null 2>&1

cat > "$APP_DIR/app.py" << 'PYAPP'
from fastapi import FastAPI
from fastapi.responses import JSONResponse
import subprocess

app = FastAPI()

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/gpu")
def gpu():
    try:
        out = subprocess.check_output([
            "nvidia-smi",
            "--query-gpu=name,uuid,memory.total,memory.free,memory.used",
            "--format=csv,noheader"
        ], stderr=subprocess.STDOUT, text=True, timeout=5)
        lines = [l.strip() for l in out.strip().split("\n") if l.strip()]
        gpus = []
        for line in lines:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 5:
                gpus.append({
                    "name": parts[0],
                    "uuid": parts[1],
                    "memory_total": parts[2],
                    "memory_free": parts[3],
                    "memory_used": parts[4],
                })
        return {"gpus": gpus}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
PYAPP

cat > /tmp/gpu-service.service <<SVC
[Unit]
Description=Simple GPU HTTP Service (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${'${APP_DIR}'}
ExecStart=${'${APP_DIR}'}/venv/bin/uvicorn app:app --host 0.0.0.0 --port ${port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

$SUDO mv /tmp/gpu-service.service /etc/systemd/system/gpu-service.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now gpu-service
sleep 2
$SUDO systemctl is-active --quiet gpu-service
            `,
        }, { parent: this, customTimeouts: { create: "10m", update: "10m" } });

        this.serviceReady = setup.stdout.apply(() => true);
        this.registerOutputs({ serviceReady: this.serviceReady });
    }
}
