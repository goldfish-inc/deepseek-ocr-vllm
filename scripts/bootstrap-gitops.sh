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

    # Check GitHub token
    if [ -z "$GITHUB_TOKEN" ]; then
        echo "❌ GITHUB_TOKEN not set. Please export GITHUB_TOKEN."
        exit 1
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
    echo "🔐 Configuring Pulumi credentials..."

    # Check if credentials already exist
    if kubectl get secret pulumi-credentials -n pulumi-system &> /dev/null; then
        echo "⚠️  Pulumi credentials already configured"
        return
    fi

    # Prompt for Pulumi access token
    read -sp "Enter Pulumi Access Token: " PULUMI_ACCESS_TOKEN
    echo ""
    read -sp "Enter Pulumi Config Passphrase: " PULUMI_CONFIG_PASSPHRASE
    echo ""

    # Create secret
    kubectl create secret generic pulumi-credentials \
        --from-literal=accessToken="$PULUMI_ACCESS_TOKEN" \
        --from-literal=configPassphrase="$PULUMI_CONFIG_PASSPHRASE" \
        -n pulumi-system

    echo "✅ Pulumi credentials configured"
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
    echo "5. Commit changes to trigger GitOps:"
    echo "   git add clusters/"
    echo "   git commit -m 'feat: Enable GitOps with Flux + PKO'"
    echo "   git push origin main"
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