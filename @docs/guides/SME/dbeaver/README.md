# DBeaver Self‑Serve for SMEs

This folder gives you everything you need to connect to the staging database and run the most useful queries.

## 1) Connection (read‑only)

Open DBeaver → Database → New Connection → PostgreSQL and enter:

- Host: `p.<cluster-id>.db.postgresbridge.com` (CrunchyBridge host)
- Port: `5432`
- Database: `<db>` (your staging DB name)
- User: `<user>` (read‑only)
- Password: `<password>` (read‑only)
- SSL: Enabled (default)

Alternatively, use the template file for quick copy/paste:

- See: `./connection-template.txt`

## 2) Saved Queries

Open `./snippets/sme_saved_queries.sql` in DBeaver’s SQL Editor and save as your personal script. It contains:

- Recent document stats (start here)
- NER spans by document
- CSV cells needing review
- Recent training corrections

## 3) Safety

- The read‑only account prevents accidental edits.
- Prefer using views like `stage.v_document_processing_stats` and `stage.v_review_queue` for quick triage.
