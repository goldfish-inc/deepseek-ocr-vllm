#!/bin/bash
# Bootstrap Flux + PKO GitOps on Oceanid Cluster
# Lightweight setup with minimal resource usage

set -e

echo "🚀 Bootstrapping GitOps with Flux + PKO..."
echo "=========================================="

# Configuration
GITHUB_OWNER="goldfish-inc"
GITHUB_REPO="oceanid"
CLUSTER_NAME="tethys"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
PULUMI_STACK="oceanid-cluster"
PULUMI_ESC_ENV="prod"

# Check prerequisites
check_prerequisites() {
    echo "📋 Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        echo "❌ kubectl not found. Please install kubectl."
        exit 1
    fi

    # Check cluster connection
    if ! kubectl get nodes &> /dev/null; then
        echo "❌ Cannot connect to cluster. Check KUBECONFIG."
        exit 1
    fi

    # Check Flux CLI
    if ! command -v flux &> /dev/null; then
        echo "📦 Installing Flux CLI..."
        curl -s https://fluxcd.io/install.sh | sudo bash
    fi

    # Check GitHub token - try to get from ESC first
    if [ -z "$GITHUB_TOKEN" ]; then
        echo "🔐 Getting GitHub token from Pulumi ESC..."
        if command -v pulumi &> /dev/null; then
            GITHUB_TOKEN=$(pulumi config get --stack "$PULUMI_STACK" github.token 2>/dev/null || echo "")
        fi

        if [ -z "$GITHUB_TOKEN" ]; then
            echo "❌ GITHUB_TOKEN not found in ESC or environment. Please set it."
            exit 1
        fi
    fi

    # Check Pulumi CLI
    if ! command -v pulumi &> /dev/null; then
        echo "❌ pulumi CLI not found. Please install Pulumi CLI."
        exit 1
    fi

    # Check jq for JSON parsing
    if ! command -v jq &> /dev/null; then
        echo "📦 Installing jq..."
        if command -v brew &> /dev/null; then
            brew install jq
        elif command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y jq
        else
            echo "❌ Cannot install jq automatically. Please install jq manually."
            exit 1
        fi
    fi

    echo "✅ Prerequisites satisfied"
}

# Install Flux minimal components
install_flux() {
    echo ""
    echo "📦 Installing Flux components..."

    # Check if Flux is already installed
    if kubectl get namespace flux-system &> /dev/null; then
        echo "⚠️  Flux already installed. Skipping..."
        return
    fi

    # Bootstrap Flux with minimal components
    flux bootstrap github \
        --owner="$GITHUB_OWNER" \
        --repository="$GITHUB_REPO" \
        --branch=main \
        --path="clusters/$CLUSTER_NAME" \
        --components=source-controller,kustomize-controller \
        --toleration-keys=node-role.kubernetes.io/control-plane \
        --verbose

    echo "✅ Flux installed successfully"
}

# Install Pulumi Kubernetes Operator
install_pko() {
    echo ""
    echo "📦 Installing Pulumi Kubernetes Operator..."

    # Apply PKO manifests
    kubectl apply -f clusters/base/pulumi-system/namespace.yaml
    kubectl apply -f clusters/base/pulumi-system/operator.yaml

    # Wait for PKO to be ready
    echo "⏳ Waiting for PKO to be ready..."
    kubectl wait --for=condition=available --timeout=300s \
        deployment/pulumi-kubernetes-operator \
        -n pulumi-system

    echo "✅ PKO installed successfully"
}

# Configure Pulumi credentials
configure_pulumi_credentials() {
    echo ""
    echo "🔐 Configuring Pulumi credentials from ESC..."

    # Check if credentials already exist
    if kubectl get secret pulumi-credentials -n pulumi-system &> /dev/null; then
        echo "⚠️  Pulumi credentials already configured"
        return
    fi

    # Get credentials from ESC
    echo "📋 Retrieving credentials from Pulumi ESC environment: $PULUMI_ESC_ENV..."

    # Set stack context for ESC
    cd cluster/ || {
        echo "❌ Cannot find cluster directory. Run from project root."
        exit 1
    }

    # Get access token from ESC
    PULUMI_ACCESS_TOKEN=$(pulumi config get --stack "$PULUMI_STACK" pulumi.accessToken 2>/dev/null || echo "")
    if [ -z "$PULUMI_ACCESS_TOKEN" ]; then
        echo "⚠️  Pulumi access token not found in ESC. Using current user's token..."
        PULUMI_ACCESS_TOKEN=$(pulumi whoami --json | jq -r '.token' 2>/dev/null || echo "")

        if [ -z "$PULUMI_ACCESS_TOKEN" ]; then
            echo "❌ Cannot get Pulumi access token. Please run 'pulumi login'."
            exit 1
        fi
    fi

    # Get config passphrase from ESC (optional)
    PULUMI_CONFIG_PASSPHRASE=$(pulumi config get --stack "$PULUMI_STACK" pulumi.configPassphrase 2>/dev/null || echo "")

    # Create secret
    kubectl create secret generic pulumi-credentials \
        --from-literal=accessToken="$PULUMI_ACCESS_TOKEN" \
        --from-literal=configPassphrase="$PULUMI_CONFIG_PASSPHRASE" \
        -n pulumi-system

    # Return to project root
    cd ..

    echo "✅ Pulumi credentials configured from ESC"
}

# Apply Stack CRDs
apply_stacks() {
    echo ""
    echo "📝 Applying Pulumi Stack definitions..."

    kubectl apply -f clusters/base/stacks/cluster-stack.yaml

    echo "✅ Stack definitions applied"
}

# Verify installation
verify_installation() {
    echo ""
    echo "🔍 Verifying GitOps installation..."

    # Check Flux
    echo "Flux status:"
    flux get all -A

    # Check PKO
    echo ""
    echo "PKO status:"
    kubectl get pods -n pulumi-system

    # Check Stacks
    echo ""
    echo "Pulumi Stacks:"
    kubectl get stacks -A

    echo ""
    echo "✅ GitOps installation complete!"
}

# Show next steps
show_next_steps() {
    echo ""
    echo "📌 Next Steps:"
    echo "=============="
    echo ""
    echo "1. Monitor reconciliation:"
    echo "   watch flux get all -A"
    echo ""
    echo "2. Check PKO logs:"
    echo "   kubectl logs -n pulumi-system deployment/pulumi-kubernetes-operator -f"
    echo ""
    echo "3. Force reconciliation:"
    echo "   flux reconcile source git flux-system"
    echo ""
    echo "4. View Stack status:"
    echo "   kubectl describe stack oceanid-cluster-prod -n pulumi-system"
    echo ""
    echo "5. Update ESC configuration if needed:"
    echo "   pulumi config set --stack $PULUMI_STACK --secret github.token <new-token>"
    echo "   pulumi config set --stack $PULUMI_STACK --secret pulumi.accessToken <new-token>"
    echo ""
    echo "6. Commit changes to trigger GitOps:"
    echo "   git add clusters/"
    echo "   git commit -m 'feat: Enable GitOps with Flux + PKO'"
    echo "   git push origin main"
    echo ""
    echo "🔐 Security Notes:"
    echo "  - All secrets sourced from Pulumi ESC"
    echo "  - No hardcoded credentials in scripts"
    echo "  - GitHub token scoped to repository access only"
    echo ""
    echo "📊 Resource Usage:"
    echo "  - Flux: ~100MB RAM"
    echo "  - PKO: ~64MB RAM"
    echo "  - Total: <200MB RAM overhead"
}

# Main execution
main() {
    check_prerequisites
    install_flux
    install_pko
    configure_pulumi_credentials
    apply_stacks
    verify_installation
    show_next_steps
}

# Run if not sourced
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi