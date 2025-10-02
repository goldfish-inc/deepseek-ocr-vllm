# Label Studio Triton Adapter

## Image Versioning

All adapter images are tagged with immutable git commit SHAs for deterministic deployments.

### Image Tags

Images are built and pushed to GHCR with two tags:
- **Immutable SHA tag**: `ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:<commit-sha>` (used for deployments)
- **Mutable main tag**: `ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:main` (for convenience)

### Deployment Process

1. **Code changes**: Push changes to `adapter/` directory on `main` branch
2. **Build workflow**: GitHub Actions automatically builds and pushes images with SHA tags
3. **ESC update**: Deploy workflow updates Pulumi ESC config with new SHA-tagged image
4. **Manual deployment**: Run `pulumi -C cluster up` locally to deploy new image

### Current Deployed Image

```bash
# Check deployed image tag
KUBECONFIG=~/.kube/k3s-config.yaml kubectl get deploy ls-triton-adapter -n apps -o jsonpath='{.spec.template.spec.containers[0].image}'
```

### Rollback Procedure

To rollback to a previous version:

1. Find the git commit SHA you want to rollback to:
   ```bash
   git log --oneline adapter/
   ```

2. Update ESC config with the old SHA tag:
   ```bash
   esc env set default/oceanid-cluster \
     "pulumiConfig.oceanid-cluster:adapterImage" \
     "ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:<old-commit-sha>" \
     --plaintext
   ```

3. Deploy the rollback:
   ```bash
   cd cluster
   pnpm build
   pulumi up
   ```

4. Verify rollback:
   ```bash
   KUBECONFIG=~/.kube/k3s-config.yaml kubectl get pods -n apps -l app=ls-triton-adapter
   KUBECONFIG=~/.kube/k3s-config.yaml kubectl logs -n apps deployment/ls-triton-adapter --tail=20
   ```

### Troubleshooting

**Image pull errors**: Verify GHCR credentials are valid:
```bash
KUBECONFIG=~/.kube/k3s-config.yaml kubectl get secret ghcr-creds -n apps -o yaml
```

**Pod not updating**: Force restart deployment:
```bash
KUBECONFIG=~/.kube/k3s-config.yaml kubectl rollout restart deployment/ls-triton-adapter -n apps
```

**Check image history**:
```bash
# List all adapter images in GHCR
gh api /user/packages/container/oceanid%2Fls-triton-adapter/versions | jq -r '.[].metadata.container.tags[]' | sort
```
