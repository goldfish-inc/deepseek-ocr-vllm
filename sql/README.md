Oceanid Intelligence Staging — SQL Migrations

Overview

- Authoritative schema for raw, stage, label, curated, and control.
- Idempotent SQL files applied in lexicographic order.

Usage

- Set DB_URL (or export DATABASE_URL) to your CrunchyBridge/Postgres URI, then:

```
make db:migrate               # apply all migrations in sql/migrations
make db:psql                  # open psql against DB_URL
```

Notes

- The Annotations Sink writes to stage.* when DATABASE_URL is set in its environment.
- Prefer running migrations from your workstation against CrunchyBridge.
- Keep sink bootstrap DDL as a safety net; treat these SQL files as source of truth.
