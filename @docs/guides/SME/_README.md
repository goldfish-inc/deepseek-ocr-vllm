# SME Docs

Central hub for Subject Matter Expert documentation. Start here, then dive into the interactive guide.

## Quick Links

- Interactive guide: `./index.mdx`
- Workflow guide: `./workflow.md`
- DBeaver self‑serve: `./dbeaver/README.md`
- Connection template: `./dbeaver/connection-template.txt`
- Saved queries: `./dbeaver/snippets/sme_saved_queries.sql`
- Project setup (Label Studio): `./project-setup.mdx`
- Docs‑site SQLPlayground setup (read‑only staging): `../../operations/sqlplayground-connection.mdx`

## Quick Start

1) Upload to Label Studio and open a task to see pre‑labels.

2) Annotate with tight spans and specific labels (e.g., `IMO`).

3) View your data in staging with DBeaver (read‑only). Use the saved queries as a starting point.

4) Try the live SQL examples in the interactive guide if your docs site has SQLPlayground enabled.

## Notes

- Storage: All uploads are stored durably in S3/MinIO; the database holds metadata and extracted values.
- Manage NER labels: see the guide’s self‑service section. Common workflow:

```bash
# From repo root
make ner:labels-apply
```

- Schema updates: small staging views or typed columns are fine; follow the patterns in the guide.
> Archived: Label Studio content retained for history. Active SME workflow uses Argilla; see `workers/vessel-ner`.
