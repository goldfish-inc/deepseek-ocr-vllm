# Database Test Harness

This directory contains SQL tests organized by implementation phase. Tests are executed in CI against a temporary Postgres instance and should gate progress for each phase.

## Structure

- `phase0/` – basic schemas and staging tables exist
- `phase1/` – curated core entities, dataset registry, temporal assertions
- `phase2/` – deterministic promotions, enrichment view, idempotency checks
- `phase3/` – enrichment view contract

## Running Locally

Provide a Postgres URL and run migrations + tests:

```
# Apply only versioned migrations
make db-migrate-ci DB_URL=postgres://user:pass@host:5432/db

# Run a phase test suite (e.g., phase0)
bash scripts/ci/run_db_tests.sh phase0
```

Tests are simple SQL files that should raise an exception when expectations aren’t met. Keep tests small, focused, and deterministic.
