# Script Retirement Summary

We replaced fragile shell workflows with infrastructure-as-code and CI:

- Cluster deployment: GitHub self-hosted runner + Pulumi OIDC
- Secrets/config: Pulumi ESC (environment: default/oceanid-cluster)
- Migrations: database-migrations workflow (no heredocs)
- Policy: pre-commit + actionlint + shellcheck + yamllint

Remaining scripts are operational helpers and validated by CI; new features must use IaC or documented workflows.
