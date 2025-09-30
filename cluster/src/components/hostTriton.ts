import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostTritonArgs {
    host: string;
    user: string;
    privateKey: pulumi.Input<string>;
    modelRepoPath?: string; // default /opt/triton/models
    image?: string; // default ghcr.io/triton-inference-server/server:2.60.0-py3
    httpPort?: number; // default 8000
    grpcPort?: number; // default 8001
    metricsPort?: number; // default 8002
}

export class HostTriton extends pulumi.ComponentResource {
    public readonly serviceReady: pulumi.Output<boolean>;

    constructor(name: string, args: HostTritonArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:compute:HostTriton", name, {}, opts);

        const {
            host,
            user,
            privateKey,
            modelRepoPath = "/opt/triton/models",
            image = "ghcr.io/triton-inference-server/server:2.60.0-py3",
            httpPort = 8000,
            grpcPort = 8001,
            metricsPort = 8002,
        } = args;

        const setup = new command.remote.Command(`${name}-setup`, {
            connection: { host, user, privateKey },
            create: `
set -euo pipefail

SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

# Install Docker if missing
if ! command -v docker >/dev/null 2>&1; then
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y ca-certificates curl gnupg >/dev/null 2>&1 || true
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1 || true
fi

# Install NVIDIA Container Toolkit if missing (best-effort)
if ! dpkg -l | grep -q nvidia-container-toolkit; then
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y nvidia-container-toolkit >/dev/null 2>&1 || true
  $SUDO nvidia-ctk runtime configure --runtime=docker >/dev/null 2>&1 || true
  $SUDO systemctl restart docker >/dev/null 2>&1 || true
fi

$SUDO mkdir -p ${modelRepoPath}
if [ ! -f ${modelRepoPath}/README ]; then
  echo "Place Triton models under this directory. Example: ${modelRepoPath}/my-model/1/..." | $SUDO tee ${modelRepoPath}/README >/dev/null
fi

cat > /tmp/tritonserver.service <<SVC
[Unit]
Description=NVIDIA Triton Inference Server
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStart=/usr/bin/docker run --gpus all --rm \
  --name tritonserver \
  -p ${httpPort}:8000 -p ${grpcPort}:8001 -p ${metricsPort}:8002 \
  -v ${modelRepoPath}:/models \
  ${image} tritonserver --model-repository=/models
ExecStop=/usr/bin/docker rm -f tritonserver

[Install]
WantedBy=multi-user.target
SVC

$SUDO mv /tmp/tritonserver.service /etc/systemd/system/tritonserver.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now tritonserver
sleep 2
$SUDO systemctl is-active --quiet tritonserver
            `,
        }, { parent: this, customTimeouts: { create: "20m", update: "20m" } });

        this.serviceReady = setup.stdout.apply(() => true);
        this.registerOutputs({ serviceReady: this.serviceReady });
    }
}
