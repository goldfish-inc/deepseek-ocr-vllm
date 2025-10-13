import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface GitHubRunnerArgs {
    host: string;
    privateKey: pulumi.Input<string>;
    githubToken: pulumi.Input<string>;
    repository: string; // Format: "owner/repo"
    runnerName: string;
    labels?: string[]; // Additional labels beyond "self-hosted,Linux,X64"
}

export class GitHubRunner extends pulumi.ComponentResource {
    public readonly runnerReady: pulumi.Output<boolean>;
    public readonly runnerName: pulumi.Output<string>;

    constructor(name: string, args: GitHubRunnerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:infrastructure:GitHubRunner", name, {}, opts);

        const { host, privateKey, githubToken, repository, runnerName, labels = [] } = args;

        // Step 1: Install runner prerequisites
        const installPrereqs = new command.remote.Command(`${name}-install-prereqs`, {
            connection: {
                host: host,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                # Detect OS type
                if [ -f /etc/alpine-release ]; then
                    OS_TYPE="alpine"
                elif [ -f /etc/debian_version ] || [ -f /etc/lsb-release ]; then
                    OS_TYPE="debian"
                else
                    echo "Unsupported OS"
                    exit 1
                fi

                echo "Detected OS: $OS_TYPE"

                # Install prerequisites
                if [ "$OS_TYPE" = "alpine" ]; then
                    apk add --no-cache curl jq bash tar gzip git
                else
                    apt-get update
                    apt-get install -y curl jq bash tar gzip git
                fi

                # Create runner user and directory
                if ! id -u actions >/dev/null 2>&1; then
                    if [ "$OS_TYPE" = "alpine" ]; then
                        adduser -D -s /bin/bash actions
                    else
                        useradd -m -s /bin/bash actions
                    fi
                fi

                mkdir -p /home/actions/runner
                chown -R actions:actions /home/actions

                echo "Prerequisites installed"
            `,
        }, { parent: this, customTimeouts: { create: "15m", update: "15m" } });

        // Step 2: Download and configure runner
        const configureRunner = new command.remote.Command(`${name}-configure`, {
            connection: {
                host: host,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                cd /home/actions/runner

                # Get latest runner version
                RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/v//')

                # Download runner if not already present
                if [ ! -f "bin/Runner.Listener" ]; then
                    curl -o actions-runner-linux-x64.tar.gz -L "https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz"
                    tar xzf actions-runner-linux-x64.tar.gz
                    rm actions-runner-linux-x64.tar.gz
                    chown -R actions:actions /home/actions/runner
                fi

                # Get registration token from GitHub API
                REGISTRATION_TOKEN=$(curl -s -X POST \
                    -H "Authorization: token ${githubToken}" \
                    -H "Accept: application/vnd.github.v3+json" \
                    "https://api.github.com/repos/${repository}/actions/runners/registration-token" | jq -r '.token')

                if [ -z "$REGISTRATION_TOKEN" ] || [ "$REGISTRATION_TOKEN" = "null" ]; then
                    echo "Failed to get registration token from GitHub"
                    exit 1
                fi

                # Configure runner as actions user
                RUNNER_LABELS="self-hosted,Linux,X64,${labels.join(",")}"
                su - actions -c "cd /home/actions/runner && ./config.sh --url https://github.com/${repository} --token $REGISTRATION_TOKEN --name ${runnerName} --labels $RUNNER_LABELS --unattended --replace"

                echo "Runner configured successfully"
            `,
        }, { parent: this, dependsOn: [installPrereqs], customTimeouts: { create: "15m", update: "15m" } });

        // Step 3: Install and start runner service
        const installService = new command.remote.Command(`${name}-install-service`, {
            connection: {
                host: host,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                cd /home/actions/runner

                # Detect OS for service management
                if [ -f /etc/alpine-release ]; then
                    OS_TYPE="alpine"
                else
                    OS_TYPE="debian"
                fi

                # Install service
                if [ "$OS_TYPE" = "alpine" ]; then
                    # Alpine: Create OpenRC service
                    cat > /etc/init.d/actions-runner << 'EOF'
#!/sbin/openrc-run

name="GitHub Actions Runner"
description="GitHub Actions self-hosted runner"

command="/home/actions/runner/run.sh"
command_user="actions"
command_background=true
pidfile="/run/actions-runner.pid"

depend() {
    need net
    after firewall
}
EOF
                    chmod +x /etc/init.d/actions-runner
                    rc-update add actions-runner default
                    rc-service actions-runner start
                else
                    # Ubuntu/Debian: Use systemd
                    su - actions -c "cd /home/actions/runner && sudo ./svc.sh install"
                    su - actions -c "cd /home/actions/runner && sudo ./svc.sh start"
                fi

                # Verify service is running
                sleep 5
                if [ "$OS_TYPE" = "alpine" ]; then
                    rc-service actions-runner status
                else
                    systemctl is-active actions.runner.${runnerName}.service
                fi

                echo "Runner service installed and started"
            `,
        }, { parent: this, dependsOn: [configureRunner], customTimeouts: { create: "15m", update: "15m" } });

        this.runnerReady = installService.stdout.apply(output =>
            output.includes("started") || output.includes("active")
        );
        this.runnerName = pulumi.output(runnerName);

        this.registerOutputs({
            runnerReady: this.runnerReady,
            runnerName: this.runnerName,
        });
    }
}
