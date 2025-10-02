# Pulumi ESC Environment Setup

## Environment: `default/oceanid-cluster`

This document confirms the Pulumi ESC (Environments, Secrets, and Configuration) setup for the Oceanid infrastructure stack.

## ✅ Configuration Status

All required secrets and configuration values are properly configured in the ESC environment.

### Cloudflare Configuration

- ✅ **API Token**: Encrypted and stored
- ✅ **Account ID**: `8fa97474778c8a894925c148ca829739`
- ✅ **Tunnel ID**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- ✅ **Tunnel Token**: Encrypted and stored
- ✅ **Origin CA Key**: Encrypted and stored

### Kubernetes/K3s Configuration

- ✅ **K3s Token**: Encrypted and stored
- ✅ **Server URL**: `https://tethys.boathou.se:6443`
- ✅ **Cluster Name**: `oceanid-cluster`

### Node Configuration

- ✅ **Tethys**: IP `157.173.210.123`, hostname `srv712429`
- ✅ **Styx**: IP `191.101.1.3`, hostname `srv712695`
- ✅ **Calypso**: IP `192.168.2.80`, hostname `calypso`, GPU `rtx4090`
- ✅ **Meliae**: IP `140.238.138.35`

### SSH Keys

- ✅ **Tethys SSH Key**: Encrypted, ID `cm2z67lskn7lddqgrghd7dvn6m`
- ✅ **Styx SSH Key**: Encrypted, ID `46scrxz74mmujzn7yuh2g7iisa`
- ✅ **Calypso SSH Key**: Encrypted, ID `calypso_key_in_tmp`
- ✅ **Rotation Schedule**: 90-day interval, next rotation `2025-12-25T16:54:53Z`

### Environment Variables

The following environment variables are automatically set when using this ESC environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_TUNNEL_TOKEN`
- `CLOUDFLARE_TUNNEL_ID`
- `CLUSTER_NAME`

## Stack Integration

The production stack `ryan-taylor/oceanid-cluster/prod` is configured to use this ESC environment:

```yaml
# Pulumi.prod.yaml
environment:
  imports:
    - default/oceanid-cluster
```

## Usage

### View Configuration

```bash
# View all ESC configuration (secrets hidden)
pulumi env get default/oceanid-cluster

# Access specific values in Pulumi program
pulumi config get clusterName
# Output: oceanid-cluster
```

### Update Secrets

```bash
# Update a secret value
pulumi env set default/oceanid-cluster cloudflare.api_token --secret

# Update plain text value
pulumi env set default/oceanid-cluster cluster.name oceanid-cluster
```

### Stack Commands

```bash
# Select the production stack
pulumi stack select ryan-taylor/oceanid-cluster/prod

# Verify ESC configuration is loaded
pulumi config

# Run preview with ESC configuration
pulumi preview
```

## Security Notes

1. All sensitive values are encrypted at REST in Pulumi Cloud
2. Secrets are never exposed in logs or console output
3. Access to ESC environments requires Pulumi Cloud authentication
4. SSH keys rotate automatically every 90 days
5. API tokens should be rotated periodically

## Validation

To validate the ESC configuration is working:

1. Run `pulumi config` - should show all configuration values
2. Run `pulumi preview` - should not show any missing configuration errors
3. Check environment variables are set correctly during deployment

## Troubleshooting

If configuration values are not loading:

1. Ensure you're authenticated: `pulumi whoami`
2. Verify ESC environment exists: `pulumi env ls`
3. Check stack imports ESC: `cat Pulumi.prod.yaml | grep environment`
4. Refresh configuration: `pulumi config refresh --force`

## References

- [Pulumi ESC Documentation](https://www.pulumi.com/docs/esc/)
- [ESC Best Practices](https://www.pulumi.com/docs/esc/best-practices/)
- [Secret Management Guide](https://www.pulumi.com/docs/concepts/secrets/)
