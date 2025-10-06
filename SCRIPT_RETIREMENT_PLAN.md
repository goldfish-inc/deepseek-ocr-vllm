# Script Retirement Plan

Goal: Replace ad-hoc shell scripts with Pulumi IaC, OPA policies, and GitHub Actions.

Scope:
- Cluster bootstrap, tunnels, and services are managed via Pulumi (cluster/)
- Cloud resources via Pulumi (cloud/)
- CI workflows replace manual scripts where possible

Phases:
1) Inventory scripts and owners
2) Replace with typed Pulumi components or GitHub Actions
3) Add OPA/pre-commit checks and remove scripts

Current Status:
- SSH tunnel workflows deprecated
- Cluster applies use self-hosted runner + OIDC
- Migrations and policy enforcement linting active in CI
