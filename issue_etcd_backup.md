## Summary
- Etcd snapshot S3 upload lacks credential wiring

## Details
- Provide S3 credentials (Access key, secret, endpoint/region) via Pulumi config/ESC
- Inject env vars / config so k3s `--etcd-s3` works

## Checks
- [ ] Extend `cluster/src/components/k3sCluster.ts`
- [ ] Document required config keys
- [ ] `pulumi preview`
- [ ] Validate snapshots land in S3 bucket
