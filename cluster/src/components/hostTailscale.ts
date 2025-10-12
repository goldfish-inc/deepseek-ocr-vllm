import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface HostTailscaleArgs {
    host: string;
    user: string;
    privateKey: pulumi.Input<string>;
    authKey: pulumi.Input<string>;
    hostname: string;
    advertiseRoutes?: string[];
    advertiseExitNode?: boolean;
    acceptRoutes?: boolean;
    acceptDNS?: boolean;
    exitNode?: string;
    exitNodeAllowLanAccess?: boolean;
    advertiseTags?: string[];
}

export class HostTailscale extends pulumi.ComponentResource {
    public readonly ready: pulumi.Output<boolean>;

    constructor(name: string, args: HostTailscaleArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:networking:HostTailscale", name, {}, opts);

        const {
            host,
            user,
            privateKey,
            authKey,
            hostname,
            advertiseRoutes = [],
            advertiseExitNode = false,
            acceptRoutes = true,
            acceptDNS = false,
            exitNode,
            exitNodeAllowLanAccess = true,
            advertiseTags = [],
        } = args;

        const routesArg = advertiseRoutes.length > 0 ? `--advertise-routes=${advertiseRoutes.join(",")}` : "";
        const tagsArg = advertiseTags.length > 0 ? `--advertise-tags=${advertiseTags.join(",")}` : "";
        const exitNodeArg = exitNode ? `--exit-node=${exitNode}` : "";
        const allowLanArg = exitNodeAllowLanAccess ? "--exit-node-allow-lan-access" : "";
        const acceptRoutesArg = acceptRoutes ? "--accept-routes" : "";
        const acceptDnsArg = acceptDNS ? "--accept-dns" : "";
        const advertiseExitNodeArg = advertiseExitNode ? "--advertise-exit-node" : "";

        const setup = new command.remote.Command(`${name}-setup`, {
            connection: { host, user, privateKey },
            create: pulumi.secret(pulumi.interpolate`
set -euo pipefail

SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

# Install tailscale if missing
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | $SUDO sh
fi

$SUDO systemctl enable --now tailscaled

# Ensure kernel forwarding for exit node
if [ "${advertiseExitNode ? "true" : "false"}" = "true" ]; then
  $SUDO mkdir -p /etc/sysctl.d
  cat <<'EOF' | $SUDO tee /etc/sysctl.d/99-tailscale-forwarding.conf >/dev/null
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
  $SUDO sysctl -p /etc/sysctl.d/99-tailscale-forwarding.conf >/dev/null
fi

TAILSCALE_ARGS="--authkey=${authKey}"
TAILSCALE_ARGS="$TAILSCALE_ARGS --hostname=${hostname}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${routesArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${tagsArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${advertiseExitNodeArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${acceptRoutesArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${acceptDnsArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${exitNodeArg}"
TAILSCALE_ARGS="$TAILSCALE_ARGS ${allowLanArg}"

# Normalize whitespace
TAILSCALE_ARGS=$(echo "$TAILSCALE_ARGS" | sed 's/[[:space:]]\\+/ /g')

if ! $SUDO tailscale status >/dev/null 2>&1; then
  $SUDO tailscale up $TAILSCALE_ARGS
else
  # Attempt to reuse existing login before falling back to full re-auth
  if ! $SUDO tailscale set ${routesArg} ${tagsArg} ${advertiseExitNode ? "--advertise-exit-node=true" : ""} >/dev/null 2>&1; then
    $SUDO tailscale up $TAILSCALE_ARGS
  else
    $SUDO tailscale set ${acceptRoutes ? "--accept-routes=true" : ""} ${acceptDNS ? "--accept-dns=true" : ""} ${exitNode ? `--exit-node=${exitNode}` : ""} ${exitNodeAllowLanAccess ? "--exit-node-allow-lan-access=true" : ""} >/dev/null 2>&1 || true
  fi
fi

$SUDO tailscale status --json >/tmp/tailscale-status.json 2>/dev/null || $SUDO tailscale status > /tmp/tailscale-status.txt 2>/dev/null || true
if command -v curl >/dev/null 2>&1; then
  curl -m 10 -sf https://ipinfo.io/ip > /tmp/tailscale-egress-ip.txt 2>/dev/null || true
fi

exit 0
`),
        }, { parent: this, customTimeouts: { create: "10m", update: "10m" } });

        this.ready = setup.stdout.apply(() => true);
        this.registerOutputs({ ready: this.ready });
    }
}
