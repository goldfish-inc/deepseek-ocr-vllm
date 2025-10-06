#!/bin/bash
# Comprehensive validation script for IaC migration
# Tests all new Pulumi components against existing shell script functionality

set -e

echo "🔍 IaC Migration Validation Suite"
echo "=================================="
echo "Validating Pulumi components against shell script functionality"
echo ""

# Configuration
CLUSTER_DIR="/Users/rt/Developer/oceanid/cluster"
KUBECONFIG_PATH="$CLUSTER_DIR/kubeconfig.yaml"
ESC_ENV="default/oceanid-cluster"
VALIDATION_LOG="/tmp/iac-migration-validation.log"
ERRORS_FOUND=0

# Initialize validation log
echo "IaC Migration Validation Report" > "$VALIDATION_LOG"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$VALIDATION_LOG"
echo "=======================================" >> "$VALIDATION_LOG"
echo "" >> "$VALIDATION_LOG"

# Function to log results
log_result() {
    local component="$1"
    local test="$2"
    local status="$3"
    local details="$4"

    echo "[$status] $component: $test" | tee -a "$VALIDATION_LOG"
    if [ -n "$details" ]; then
        echo "    $details" | tee -a "$VALIDATION_LOG"
    fi

    if [ "$status" = "FAIL" ]; then
        ERRORS_FOUND=$((ERRORS_FOUND + 1))
    fi
}

# Function to check Pulumi stack status
check_pulumi_stack() {
    echo "📦 Checking Pulumi Stack Status..."

    cd "$CLUSTER_DIR"

    if pulumi stack ls | grep -q "oceanid-cluster"; then
        log_result "Pulumi" "Stack exists" "PASS" "oceanid-cluster stack found"
    else
        log_result "Pulumi" "Stack exists" "FAIL" "oceanid-cluster stack not found"
        return 1
    fi

    # Check if components are deployed
    STACK_OUTPUTS=$(pulumi stack output --json 2>/dev/null || echo "{}")

    if echo "$STACK_OUTPUTS" | jq -e '.clusterReady' >/dev/null 2>&1; then
        log_result "Pulumi" "Cluster provisioning" "PASS" "K3s cluster component deployed"
    else
        log_result "Pulumi" "Cluster provisioning" "FAIL" "K3s cluster component not found"
    fi

    if echo "$STACK_OUTPUTS" | jq -e '.controlPlaneLB' >/dev/null 2>&1; then
        log_result "Pulumi" "Load balancer" "PASS" "Control plane load balancer deployed"
    else
        log_result "Pulumi" "Load balancer" "FAIL" "Control plane load balancer not found"
    fi
}

# Function to validate SSH key management
validate_ssh_key_management() {
    echo "🔑 Validating SSH Key Management..."

    # Check if SSH keys exist in ESC
    if esc env get "$ESC_ENV" --format json | jq -e '.ssh.tethys_private_key_base64' >/dev/null 2>&1; then
        log_result "SSH Keys" "ESC storage" "PASS" "SSH keys found in ESC"
    else
        log_result "SSH Keys" "ESC storage" "FAIL" "SSH keys not found in ESC"
    fi

    # Test SSH key rotation metadata
    LAST_ROTATION=$(esc env get "$ESC_ENV" --format json | jq -r '.ssh.last_rotation // empty' 2>/dev/null || echo "")
    if [ -n "$LAST_ROTATION" ]; then
        log_result "SSH Keys" "Rotation metadata" "PASS" "Last rotation: $LAST_ROTATION"
    else
        log_result "SSH Keys" "Rotation metadata" "WARN" "No rotation metadata found"
    fi

    # Validate SSH key formats
    for node in tethys styx calypso; do
        KEY_B64=$(esc env get "$ESC_ENV" --format json | jq -r ".ssh.${node}_private_key_base64 // empty" 2>/dev/null || echo "")
        if [ -n "$KEY_B64" ]; then
            # Decode and validate key format
            if echo "$KEY_B64" | base64 -d | ssh-keygen -l -f - >/dev/null 2>&1; then
                log_result "SSH Keys" "$node key format" "PASS" "Valid SSH key format"
            else
                log_result "SSH Keys" "$node key format" "FAIL" "Invalid SSH key format"
            fi
        else
            log_result "SSH Keys" "$node key exists" "FAIL" "SSH key not found for $node"
        fi
    done
}

# Function to validate K3s token management
validate_k3s_token_management() {
    echo "🔐 Validating K3s Token Management..."

    # Check if K3s token exists in ESC
    K3S_TOKEN=$(esc env get "$ESC_ENV" --format json | jq -r '.k3s.token // empty' 2>/dev/null || echo "")
    if [ -n "$K3S_TOKEN" ]; then
        log_result "K3s Token" "ESC storage" "PASS" "K3s token found in ESC"

        # Validate token format (K10{32hex}::server:{16hex})
        if [[ "$K3S_TOKEN" =~ ^K10[a-f0-9]{32}::server:[a-f0-9]{16}$ ]]; then
            log_result "K3s Token" "Format validation" "PASS" "Valid K3s token format"
        else
            log_result "K3s Token" "Format validation" "FAIL" "Invalid K3s token format"
        fi
    else
        log_result "K3s Token" "ESC storage" "FAIL" "K3s token not found in ESC"
    fi

    # Check rotation metadata
    TOKEN_ROTATED=$(esc env get "$ESC_ENV" --format json | jq -r '.k3s.token_rotated_at // empty' 2>/dev/null || echo "")
    if [ -n "$TOKEN_ROTATED" ]; then
        log_result "K3s Token" "Rotation metadata" "PASS" "Last rotation: $TOKEN_ROTATED"
    else
        log_result "K3s Token" "Rotation metadata" "WARN" "No rotation metadata found"
    fi
}

# Function to validate cluster health
validate_cluster_health() {
    echo "🏥 Validating Cluster Health..."

    export KUBECONFIG="$KUBECONFIG_PATH"

    # Check cluster connectivity
    if kubectl get nodes --no-headers >/dev/null 2>&1; then
        log_result "Cluster" "Connectivity" "PASS" "Cluster is accessible"

        # Count nodes
        TOTAL_NODES=$(kubectl get nodes --no-headers | wc -l)
        READY_NODES=$(kubectl get nodes --no-headers | grep " Ready" | wc -l)

        if [ "$TOTAL_NODES" -eq "$READY_NODES" ] && [ "$READY_NODES" -gt 0 ]; then
            log_result "Cluster" "Node health" "PASS" "$READY_NODES/$TOTAL_NODES nodes ready"
        else
            log_result "Cluster" "Node health" "FAIL" "Only $READY_NODES/$TOTAL_NODES nodes ready"
        fi

        # Check control plane health
        if kubectl get pods -n kube-system --no-headers | grep -E "(kube-apiserver|etcd)" | grep -q "Running"; then
            log_result "Cluster" "Control plane" "PASS" "Control plane pods running"
        else
            log_result "Cluster" "Control plane" "FAIL" "Control plane pods not healthy"
        fi
    else
        log_result "Cluster" "Connectivity" "FAIL" "Cannot connect to cluster"
    fi
}

# Function to validate security hardening
validate_security_hardening() {
    echo "🛡️ Validating Security Hardening..."

    export KUBECONFIG="$KUBECONFIG_PATH"

    # Check if security hardening DaemonSet exists
    if kubectl get daemonset security-hardening -n security-hardening >/dev/null 2>&1; then
        log_result "Security" "DaemonSet deployed" "PASS" "Security hardening DaemonSet found"

        # Check DaemonSet status
        DESIRED=$(kubectl get daemonset security-hardening -n security-hardening -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null || echo "0")
        READY=$(kubectl get daemonset security-hardening -n security-hardening -o jsonpath='{.status.numberReady}' 2>/dev/null || echo "0")

        if [ "$DESIRED" -eq "$READY" ] && [ "$READY" -gt 0 ]; then
            log_result "Security" "DaemonSet health" "PASS" "$READY/$DESIRED pods ready"
        else
            log_result "Security" "DaemonSet health" "FAIL" "Only $READY/$DESIRED pods ready"
        fi
    else
        log_result "Security" "DaemonSet deployed" "FAIL" "Security hardening DaemonSet not found"
    fi
}

# Function to validate GitOps components
validate_gitops_components() {
    echo "🔄 Validating GitOps Components..."

    export KUBECONFIG="$KUBECONFIG_PATH"

    # Check Flux namespace
    if kubectl get namespace flux-system >/dev/null 2>&1; then
        log_result "GitOps" "Flux namespace" "PASS" "flux-system namespace exists"
    else
        log_result "GitOps" "Flux namespace" "FAIL" "flux-system namespace not found"
        return 1
    fi

    # Check Flux controllers
    for controller in source-controller kustomize-controller helm-controller; do
        if kubectl get deployment "$controller" -n flux-system >/dev/null 2>&1; then
            REPLICAS=$(kubectl get deployment "$controller" -n flux-system -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
            if [ "$REPLICAS" -gt 0 ]; then
                log_result "GitOps" "$controller" "PASS" "Controller running ($REPLICAS replicas)"
            else
                log_result "GitOps" "$controller" "FAIL" "Controller not ready"
            fi
        else
            log_result "GitOps" "$controller" "FAIL" "Controller not found"
        fi
    done

    # Check GitRepository
    if kubectl get gitrepository flux-system -n flux-system >/dev/null 2>&1; then
        GIT_STATUS=$(kubectl get gitrepository flux-system -n flux-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
        if [ "$GIT_STATUS" = "True" ]; then
            log_result "GitOps" "GitRepository" "PASS" "GitRepository is ready"
        else
            log_result "GitOps" "GitRepository" "FAIL" "GitRepository not ready (status: $GIT_STATUS)"
        fi
    else
        log_result "GitOps" "GitRepository" "FAIL" "GitRepository not found"
    fi

    # Check Kustomization
    if kubectl get kustomization flux-system -n flux-system >/dev/null 2>&1; then
        KUSTOMIZE_STATUS=$(kubectl get kustomization flux-system -n flux-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
        if [ "$KUSTOMIZE_STATUS" = "True" ]; then
            log_result "GitOps" "Kustomization" "PASS" "Kustomization is ready"
        else
            log_result "GitOps" "Kustomization" "FAIL" "Kustomization not ready (status: $KUSTOMIZE_STATUS)"
        fi
    else
        log_result "GitOps" "Kustomization" "FAIL" "Kustomization not found"
    fi
}

# Function to validate credential synchronization
validate_credential_sync() {
    echo "🔄 Validating Credential Synchronization..."

    # Check sync metadata in ESC
    LAST_SYNC=$(esc env get "$ESC_ENV" --format json | jq -r '.sync.last_sync // empty' 2>/dev/null || echo "")
    if [ -n "$LAST_SYNC" ]; then
        log_result "Credentials" "Sync metadata" "PASS" "Last sync: $LAST_SYNC"
    else
        log_result "Credentials" "Sync metadata" "WARN" "No sync metadata found"
    fi

    # Validate credentials exist in both ESC and can be accessed
    CREDENTIALS=("k3s.token" "github.token" "ssh.tethys_private_key_base64")
    for cred in "${CREDENTIALS[@]}"; do
        if esc env get "$ESC_ENV" --format json | jq -e ".$cred" >/dev/null 2>&1; then
            log_result "Credentials" "$cred exists" "PASS" "Credential found in ESC"
        else
            log_result "Credentials" "$cred exists" "FAIL" "Credential not found in ESC"
        fi
    done
}

# Function to compare IaC vs Script outputs
compare_iac_vs_scripts() {
    echo "⚖️ Comparing IaC vs Script Functionality..."

    # Test SSH key format consistency
    log_result "Comparison" "SSH key formats" "INFO" "Manual verification required"

    # Test K3s token format consistency
    log_result "Comparison" "K3s token formats" "INFO" "Manual verification required"

    # Test cluster health reporting consistency
    log_result "Comparison" "Health reporting" "INFO" "Manual verification required"

    echo "    📝 Note: Detailed comparison requires manual verification"
    echo "    📝 Run both systems in parallel and compare outputs"
}

# Function to check readiness for script retirement
check_script_retirement_readiness() {
    echo "🗑️ Checking Script Retirement Readiness..."

    CRITICAL_FAILURES=0

    # Check if all IaC components are healthy
    if [ "$ERRORS_FOUND" -eq 0 ]; then
        log_result "Retirement" "IaC health" "PASS" "All IaC components healthy"
    else
        log_result "Retirement" "IaC health" "FAIL" "$ERRORS_FOUND errors found"
        CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
    fi

    # Check if migration phase is appropriate
    MIGRATION_PHASE=$(pulumi stack output --json 2>/dev/null | jq -r '.migrationStatus.phase // "unknown"' || echo "unknown")
    if [ "$MIGRATION_PHASE" = "cutover" ] || [ "$MIGRATION_PHASE" = "cleanup" ]; then
        log_result "Retirement" "Migration phase" "PASS" "Phase: $MIGRATION_PHASE"
    else
        log_result "Retirement" "Migration phase" "FAIL" "Current phase: $MIGRATION_PHASE (need cutover or cleanup)"
        CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
    fi

    # Final retirement readiness
    if [ "$CRITICAL_FAILURES" -eq 0 ]; then
        log_result "Retirement" "Ready for script removal" "PASS" "All checks passed"
        return 0
    else
        log_result "Retirement" "Ready for script removal" "FAIL" "$CRITICAL_FAILURES critical issues"
        return 1
    fi
}

# Main validation sequence
main() {
    echo "Starting validation at $(date)"
    echo ""

    check_pulumi_stack
    validate_ssh_key_management
    validate_k3s_token_management
    validate_cluster_health
    validate_security_hardening
    validate_gitops_components
    validate_credential_sync
    compare_iac_vs_scripts
    check_script_retirement_readiness

    echo ""
    echo "📊 Validation Summary"
    echo "===================="
    echo "Total errors found: $ERRORS_FOUND"
    echo "Validation log: $VALIDATION_LOG"
    echo ""

    if [ "$ERRORS_FOUND" -eq 0 ]; then
        echo "✅ All validations passed! IaC migration is successful."
        echo "📝 Ready to proceed with script retirement."
        exit 0
    else
        echo "⚠️  $ERRORS_FOUND errors found. Review and fix before retiring scripts."
        echo "📋 Check validation log for details: $VALIDATION_LOG"
        exit 1
    fi
}

# Run if not sourced
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
