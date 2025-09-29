#!/usr/bin/env bash
# SME Deployment Script for Label Studio on boathou.se
# Run this to configure and deploy Label Studio for SME usage

set -e

echo "=== SME Label Studio Deployment on boathou.se ==="
echo ""

# Check prerequisites
command -v pulumi >/dev/null 2>&1 || { echo "Error: pulumi CLI not installed"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "Error: kubectl not installed"; exit 1; }

# Set stack
export STACK="ryan-taylor/oceanid-cluster/prod"
cd cluster

echo "1. Setting up boathou.se domain configuration..."
pulumi stack select $STACK

# Configure base domain
pulumi config set oceanid-cluster:cloudflareNodeTunnelHostname boathou.se
pulumi config set oceanid-cluster:cloudflareTunnelHostname k3s.boathou.se

# Enable Label Studio Access with Zero Trust (for SME protection)
echo "2. Configuring Cloudflare Access for Label Studio..."
pulumi config set oceanid-cluster:enableLabelStudioAccess true

# Set allowed email domain for SME access (update as needed)
EMAIL_DOMAIN="${ACCESS_EMAIL_DOMAIN:-boathou.se}"
echo "   Setting allowed email domain to: $EMAIL_DOMAIN"
pulumi config set oceanid-cluster:accessAllowedEmailDomain "$EMAIL_DOMAIN"

# Configure NER labels (63 labels for schema-aligned NER)
echo "3. Configuring NER labels for model..."
NER_LABELS='["O","VESSEL","VESSEL_NAME","IMO","IRCS","MMSI","FLAG","PORT","ORGANIZATION","PERSON","COMPANY","BENEFICIAL_OWNER","OPERATOR","CHARTERER","VESSEL_MASTER","CREW_MEMBER","GEAR_TYPE","VESSEL_TYPE","COMMODITY","HS_CODE","SPECIES","RISK_LEVEL","SANCTION","DATE","LOCATION","COUNTRY","RFMO","LICENSE","TONNAGE","LENGTH","ENGINE_POWER","EU_CFR","FISHING_AUTHORIZATION","FISHING_LICENSE","TRANSSHIPMENT_AUTHORIZATION","CARRIER_AUTHORIZATION","OBSERVER_AUTHORIZATION","SUPPORT_VESSEL_AUTHORIZATION","HULL_MATERIAL","VESSEL_ENGINE_TYPE","VESSEL_FUEL_TYPE","FREEZER_TYPE","BUILD_YEAR","FLAG_REGISTERED_DATE","EXTERNAL_MARKING","CREW_COUNT","METRIC_VALUE","UNIT","AUTHORIZATION_STATUS","SANCTION_TYPE","SANCTION_PROGRAM","ENTITY_TYPE","ENTITY_SUBTYPE","ASSOCIATION_TYPE","OWNERSHIP_TYPE","CONTROL_LEVEL","ADDRESS_TYPE","ALIAS_TYPE","NAME_TYPE","GENDER","RISK_SCORE","CONFIDENCE_SCORE"]'

# Store in Pulumi ESC
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:nerLabels" "$NER_LABELS" --secret

# Build the cluster components
echo "4. Building cluster components..."
cd ..
pnpm --filter @oceanid/cluster build

# Deploy minimal stack first
echo "5. Deploying base infrastructure..."
make deploy-simple

# Wait for base services to be ready
echo "6. Waiting for services to stabilize..."
sleep 30

# Check Label Studio is accessible
echo "7. Verifying Label Studio deployment..."
kubectl get pods -n apps -l app=labelstudio

# Get the tunnel URLs
echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Label Studio Access URLs:"
echo "  - Primary: https://label.boathou.se"
echo "  - K3s API: https://k3s.boathou.se"
echo "  - GPU Services: https://gpu.boathou.se"
echo ""
echo "SME Login:"
echo "  - Users with @$EMAIL_DOMAIN emails can access Label Studio"
echo "  - First-time users will go through Cloudflare Access authentication"
echo ""

# Optional: Deploy Calypso GPU services
read -p "Deploy Calypso GPU services now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Deploying Calypso connector and Triton..."
    make deploy-calypso

    echo ""
    echo "GPU Services deployed. Ensure NVIDIA drivers are installed on Calypso."
    echo "Triton health check: curl -sk https://gpu.boathou.se/v2/health/ready"
fi

echo ""
echo "Next steps:"
echo "1. SMEs can access Label Studio at https://label.boathou.se"
echo "2. Create projects and configure ML backend to use the adapter"
echo "3. Upload BERT ONNX model (63 labels) to Calypso if using NER"
echo ""
echo "For adapter testing:"
echo "kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &"
echo "curl http://localhost:9090/healthz"