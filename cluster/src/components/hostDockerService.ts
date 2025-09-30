import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostDockerServiceArgs {
    host: string;
    user: string;
    privateKey: pulumi.Input<string>;
    serviceName: string;          // systemd unit name
    image: string;                // docker image
    name?: string;                // docker container name
    ports?: Array<{ host: number; container: number }>;
    volumes?: Array<{ hostPath: string; containerPath: string }>;
    env?: Record<string, pulumi.Input<string>>;
    gpus?: boolean;               // --gpus all
    args?: string[];              // extra args after image
}

export class HostDockerService extends pulumi.ComponentResource {
    public readonly serviceReady: pulumi.Output<boolean>;

    constructor(name: string, args: HostDockerServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:compute:HostDockerService", name, {}, opts);

        const { host, user, privateKey, serviceName, image, name: containerName = serviceName,
            ports = [], volumes = [], env = {}, gpus = false, args: extraArgs = [] } = args;

        const unit = new command.remote.Command(`${name}-unit`, {
            connection: { host, user, privateKey },
            create: pulumi.all([image, env as any]).apply(([img, envObj]) => {
                const portFlags = ports.map(p => `-p ${p.host}:${p.container}`).join(" ");
                const volFlags = volumes.map(v => `-v ${v.hostPath}:${v.containerPath}`).join(" ");
                const envFlags = Object.entries(envObj || {}).map(([k, v]) => `-e ${k}='${v}'`).join(" ");
                const argsJoined = extraArgs.join(" ");

                return `
set -euo pipefail
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

# Remove snap Docker if present to avoid confinement issues with bind mounts
if command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
  echo "==> Removing snap docker"
  $SUDO snap stop docker || true
  $SUDO snap remove docker || true
fi

# Install Docker (apt) if missing
if ! command -v docker >/dev/null 2>&1; then
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y ca-certificates curl gnupg >/dev/null 2>&1 || true
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1 || true
else
  # Ensure we are using the apt-managed daemon, not snap
  if systemctl is-active --quiet snap.docker.dockerd; then
    echo "==> Stopping snap docker daemon"
    $SUDO systemctl stop snap.docker.dockerd || true
  fi
  $SUDO systemctl enable --now docker || true
fi

echo "==> Pulling image ${img} (best-effort)"
$SUDO docker pull ${img} >/dev/null 2>&1 || true

GPU_FLAG=""
if ${gpus ? "true" : "false"}; then
  # Choose GPU flag based on NVIDIA runtime mode (CSV requires --runtime=nvidia)
  RUNTIME_EXTRA=""
  USE_CSV=false
  if [ -f /etc/nvidia-container-runtime/config.toml ] && grep -q 'mode = "csv"' /etc/nvidia-container-runtime/config.toml; then
    USE_CSV=true
    RUNTIME_EXTRA="--runtime=nvidia"
  fi
  # Probe GPU availability for this image; choose flags accordingly
  if [ "$USE_CSV" = true ]; then
    if docker run --rm $RUNTIME_EXTRA --entrypoint /bin/sh ${img} -c 'exit 0' >/dev/null 2>&1; then
      GPU_FLAG="$RUNTIME_EXTRA"
    fi
  else
    if docker run --rm --gpus all --entrypoint /bin/sh ${img} -c 'exit 0' >/dev/null 2>&1; then
      GPU_FLAG="--gpus all"
    fi
  fi
fi

cat > /tmp/${serviceName}.service <<SVC
[Unit]
Description=${serviceName} container
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStart=/usr/bin/docker run --rm $GPU_FLAG \\
  --name ${containerName} ${portFlags} ${volFlags} ${envFlags} \\
  ${img} ${argsJoined}
ExecStop=/usr/bin/docker rm -f ${containerName}

[Install]
WantedBy=multi-user.target
SVC

$SUDO mv /tmp/${serviceName}.service /etc/systemd/system/${serviceName}.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now ${serviceName}
sleep 2
$SUDO systemctl is-active --quiet ${serviceName}
`;            }),
        }, { parent: this, customTimeouts: { create: "20m", update: "20m" } });

        this.serviceReady = unit.stdout.apply(() => true);
        this.registerOutputs({ serviceReady: this.serviceReady });
    }
}
