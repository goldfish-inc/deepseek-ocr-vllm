---
name: Reintroduce non-blocking DB verify Job
about: Bring back DB verification as an optional, non-blocking check
title: "Reintroduce DB verify Job (non-blocking)"
labels: enhancement
assignees: ''
---

Summary

Re-enable a DB verification Job that checks connectivity and key table counts without blocking Pulumi deploys.

Acceptance Criteria

- [ ] Job only created when `enableDbVerify=true` in Pulumi config
- [ ] Job uses `pulumi.com/skipAwait: true` and exits 0 on transient errors
- [ ] Command prints `now:` and `stage.table_ingest` count when DB reachable
- [ ] Document how to enable/disable in `docs/operations/overview.md`

Notes

- This was temporarily disabled to avoid blocking deploys when DB was unavailable. Reintroduce with strict non-blocking behavior.

