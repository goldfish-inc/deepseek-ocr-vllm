Audit: Tracing Annotations to Original PDFs (S3)

Policy
- Original PDFs are stored only in S3 via Label Studio per‑project storage (SME-provided credentials).
- The sink does not copy PDFs to Hugging Face, GitHub, or the database.
- For auditing, the sink stores:
  - `source_ref` in outbox payload JSON: `{ url, s3_bucket, s3_key, s3_version_id, tag }`
  - `source_tag` in `stage.annotations_outbox`: `s3://bucket/key#version` (version optional)

How to Search
- SQL (recommended):

```sql
SELECT id, event_id, project_id, target_repo, task_type, vertical,
       source_tag, shard_path, created_at, processed_at
FROM stage.annotations_outbox
WHERE source_tag = 's3://my-bucket/path/to/file.pdf#abc123'
ORDER BY created_at DESC
LIMIT 200;
```

- HTTP (internal):

```
GET /audit/source?tag=s3%3A%2F%2Fmy-bucket%2Fpath%2Fto%2Ffile.pdf%23abc123[&include_payload=1]
```

Response:

```
{
  "items": [
    { "id": 123, "event_id": "...", "project_id": "...", "source_tag": "s3://...", "shard_path": "...", "created_at": "...", "processed_at": "..." }
  ]
}
```

Notes
- `source_tag` derives from the S3 URL in task data or explicit `s3_bucket`/`s3_key` fields; if a versionId is present, it is included in the tag for exact provenance.
- This endpoint is internal only (service exposed inside the cluster); restrict access appropriately.
