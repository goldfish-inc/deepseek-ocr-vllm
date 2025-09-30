import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostCloudflaredArgs {
    host: string;
    user: string;
    privateKey: pulumi.Input<string>;
    tunnelId: pulumi.Input<string>;
    tunnelToken: pulumi.Input<string>;
    hostnameBase: pulumi.Input<string>; // e.g., boathou.se
    gpuPort?: number; // default 8000 (Triton HTTP v2)
}

export class HostCloudflared extends pulumi.ComponentResource {
    public readonly serviceReady: pulumi.Output<boolean>;

    constructor(name: string, args: HostCloudflaredArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:networking:HostCloudflared", name, {}, opts);

        const { host, user, privateKey, tunnelId, tunnelToken, hostnameBase, gpuPort = 8000 } = args;

        const install = new command.remote.Command(`${name}-install`, {
            connection: { host, user, privateKey },
            create: pulumi.all([tunnelId, tunnelToken, hostnameBase]).apply(([id, token, base]) => `
set -euo pipefail

SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

# Ensure basic tools
if ! command -v curl >/dev/null 2>&1; then
  $SUDO apt-get update && $SUDO apt-get install -y curl >/dev/null 2>&1 || true
fi

$SUDO mkdir -p /etc/cloudflared

# Decode token if base64-encoded JSON; otherwise use as raw token
TOKEN_RAW='${token}'
IS_B64=0
if echo "$TOKEN_RAW" | base64 -d >/tmp/cred.$$ 2>/dev/null; then
  if grep -q '"TunnelID"' /tmp/cred.$$; then
    IS_B64=1
    $SUDO mv /tmp/cred.$$ /etc/cloudflared/credentials.json
  else
    rm -f /tmp/cred.$$
  fi
fi

cat > /tmp/cloudflared-config.yaml <<'CFG'
tunnel: ${id}
no-autoupdate: true
protocol: auto
edge-ip-version: "4"
metrics: 0.0.0.0:2200

ingress:
  - hostname: gpu.${base}
    service: http://localhost:${gpuPort}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
CFG
if [ "$IS_B64" -eq 1 ]; then
  sed -i '1 a credentials-file: /etc/cloudflared/credentials.json' /tmp/cloudflared-config.yaml
fi

$SUDO mv /tmp/cloudflared-config.yaml /etc/cloudflared/config.yaml

curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
$SUDO install -m 0755 /tmp/cloudflared /usr/local/bin/cloudflared

cat > /tmp/cloudflared-node.service <<'SVC'
[Unit]
Description=Cloudflared Node Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/config.yaml run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC
if [ "$IS_B64" -ne 1 ]; then
  sed -i '/^ExecStart/i Environment=TUNNEL_TOKEN='"$TOKEN_RAW" /tmp/cloudflared-node.service
fi
$SUDO mv /tmp/cloudflared-node.service /etc/systemd/system/cloudflared-node.service

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now cloudflared-node
for i in $(seq 1 10); do
  if $SUDO systemctl is-active --quiet cloudflared-node; then
    break
  fi
  sleep 2
done
$SUDO systemctl status cloudflared-node --no-pager --full || true
exit 0
`),
        }, { parent: this, customTimeouts: { create: "10m", update: "10m" } });

        this.serviceReady = install.stdout.apply(() => true);
        this.registerOutputs({ serviceReady: this.serviceReady });
    }
}
