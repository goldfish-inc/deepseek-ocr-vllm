# SME Deployment Guide for Label Studio on boathou.se

Deploy Label Studio with Cloudflare Access for SME annotators using pure Infrastructure as Code.

## Prerequisites

- Pulumi CLI installed and authenticated
- ESC (Pulumi Environments, Secrets, Configuration) access
- Cloudflare account with boathou.se domain
- Kubernetes cluster access (kubeconfig)

## Configuration via ESC

All configuration is managed through Pulumi ESC - no shell scripts needed.

### 1. Set Core Configuration

```bash
# Apply the SME configuration
esc env set default/oceanid-cluster --file esc-sme-config.yaml

# Or set individual values
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:enableLabelStudioAccess true
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:accessAllowedEmailDomain "boathou.se"
```

### 2. Configure NER Labels (Schema-aligned)

The configuration includes 63 labels aligned with the Ebisu database schema:

```bash
# This is already in esc-sme-config.yaml, but can be updated:
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:nerLabels \
  '["O","VESSEL","VESSEL_NAME","IMO","IRCS","MMSI","FLAG","PORT",...]' --secret
```

### 3. Set Required Secrets

These should already be configured in ESC:

```bash
# Cloudflare secrets (required)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareAccountId "YOUR_ACCOUNT_ID" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareZoneId "YOUR_ZONE_ID" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareApiToken "YOUR_API_TOKEN" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareTunnelId "YOUR_TUNNEL_ID" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareTunnelToken "YOUR_TUNNEL_TOKEN" --secret

# Node tunnel secrets
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareNodeTunnelId "NODE_TUNNEL_ID" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareNodeTunnelToken "NODE_TUNNEL_TOKEN" --secret

# SSH keys (if using node provisioning)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:tethys_ssh_key "$(cat ~/.ssh/tethys_key)" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:calypso_ssh_key "$(cat ~/.ssh/calypso_key)" --secret
```

## Deployment

### Quick Deployment (Recommended)

```bash
# Build and deploy with minimal configuration
make install
make build
make deploy-simple

# Check the deployment
pulumi -C cluster stack output smeUrls
```

### Full Deployment with GPU

```bash
# Deploy base infrastructure
make deploy-simple

# Deploy Calypso GPU services
make deploy-calypso

# Verify all services
pulumi -C cluster stack output
```

## Access URLs

After deployment, SMEs can access:

- **Label Studio**: <https://label.boathou.se>
- **GPU Services**: <https://gpu.boathou.se>
- **K3s API**: <https://k3s.boathou.se>

## SME Authentication

### Cloudflare Access

Users with `@boathou.se` email addresses can authenticate via Cloudflare Access:

1. Navigate to <https://label.boathou.se>
2. Enter email address
3. Receive one-time PIN via email
4. Access Label Studio

### Adding Additional Users

```bash
# Add specific email addresses
pulumi -C cluster config set oceanid-cluster:smeAdditionalEmails '["user1@example.com","user2@example.com"]'
pulumi -C cluster up
```

## ML Backend Configuration

The adapter is automatically configured as the ML backend for Label Studio.

### Testing the Adapter

```bash
# Port-forward to test locally
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &

# Health check
curl http://localhost:9090/health

# NER prediction (once BERT model is deployed)
curl -X POST http://localhost:9090/predict \
  -H "Content-Type: application/json" \
  -d '{"model":"bert-base-uncased","task":"ner","text":"MV Ocean Warrior IMO 1234567"}'
```

## BERT Model Deployment

### Install ONNX Model on Calypso

```bash
# SSH to Calypso
ssh oceanid@192.168.2.80

# Create model directory
sudo mkdir -p /opt/triton/models/bert-base-uncased/1

# Copy your 63-label BERT ONNX model
sudo cp bert-ner-63labels.onnx /opt/triton/models/bert-base-uncased/1/model.onnx

# Restart Triton
sudo systemctl restart tritonserver
```

### Verify Model Loading

```bash
# Check Triton health
curl -sk https://gpu.boathou.se/v2/health/ready

# Check model status
curl -sk https://gpu.boathou.se/v2/models/bert-base-uncased/ready
```

## Monitoring

### Check Deployment Status

```bash
# Kubernetes pods
kubectl get pods -n apps

# Pulumi stack outputs
pulumi -C cluster stack output smeUrls
pulumi -C cluster stack output smeAccess
pulumi -C cluster stack output modelConfiguration

# Cloudflare tunnel status
kubectl logs -n kube-system deployment/cloudflared --tail=50
```

### View Access Logs

```bash
# Cloudflare Access logs (via dashboard)
# Navigate to: Zero Trust > Access > Logs

# Label Studio logs
kubectl logs -n apps deployment/label-studio --tail=100

# Adapter logs
kubectl logs -n apps deployment/ls-triton-adapter --tail=100
```

## Troubleshooting

### Label Studio Not Accessible

```bash
# Check DNS
nslookup label.boathou.se

# Check tunnel
kubectl get pods -n kube-system -l app=cloudflared

# Check ingress rules
kubectl get ingress -n apps
```

### ML Backend Connection Issues

```bash
# Verify adapter is running
kubectl get pods -n apps -l app=ls-triton-adapter

# Check environment variables
kubectl describe deployment/label-studio -n apps | grep ML_BACKEND
```

### Cloudflare Access Issues

```bash
# Verify Access policy
pulumi -C cluster stack output smeAccess

# Check email domain configuration
pulumi -C cluster config get oceanid-cluster:accessAllowedEmailDomain
```

## Infrastructure as Code Benefits

All configuration is:

- **Version controlled**: Changes tracked in Git
- **Declarative**: Desired state defined in code
- **Idempotent**: Safe to run multiple times
- **Auditable**: All changes logged in Pulumi
- **Reversible**: Easy rollback with `pulumi stack history`

## Next Steps

1. **Create Label Studio Projects**: SMEs can create annotation projects
2. **Configure ML Backend**: Projects automatically use the adapter
3. **Upload Data**: Import maritime documents for annotation
4. **Start Annotating**: SMEs begin labeling with schema-aligned entities
5. **Export Results**: Download annotations in various formats

## Support

- **Pulumi Issues**: Check `pulumi -C cluster stack` for errors
- **Kubernetes Issues**: Use `kubectl describe` for resource details
- **Cloudflare Issues**: Check Zero Trust dashboard for access logs
- **Model Issues**: Verify ONNX model dimensions match config (63 labels)
