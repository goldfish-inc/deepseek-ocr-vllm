ESC Multi‑Dataset Routing — Dry‑Run Checklist (Issue #118)

Goal: Verify that NER and Docling annotations are routed to separate HF dataset repos with vertical‑aware shard paths.

Prerequisites
- ESC configured for the cluster stack
- HF token present: `pulumiConfig.oceanid-cluster:hfAccessToken`
- Optional but recommended:
  - `pulumiConfig.oceanid-cluster:hfDatasetRepoNER` → e.g., `goldfish-inc/oceanid-annotations-ner`
  - `pulumiConfig.oceanid-cluster:hfDatasetRepoDocling` → e.g., `goldfish-inc/oceanid-annotations-docling`

1) Configure ESC keys

```bash
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfDatasetRepoNER "goldfish-inc/oceanid-annotations-ner"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfDatasetRepoDocling "goldfish-inc/oceanid-annotations-docling"

"""
```

2) Deploy

```bash
cd cluster
pulumi stack select ryan-taylor/oceanid-cluster/prod
pulumi preview
pulumi up
```

Expected delta: `annotations-sink` Deployment env should include `HF_REPO_NER`, `HF_REPO_DOCLING`. `ls-triton-adapter` spawned training Jobs should include `HF_DATASET_REPO_NER`.

3) Health + Logs

```bash
kubectl -n apps port-forward svc/annotations-sink 8081:8080 &
curl -s localhost:8081/health | jq
kubectl -n apps logs -l app=annotations-sink --tail=200
```

4) Test NER routing

Post a minimal NER webhook payload (labels/choices with start/end/labels) and verify enqueue + commit:

```bash
cat > /tmp/ner_webhook.json <<'JSON'
{
  "action": "ANNOTATION_CREATED",
  "annotation": {
    "result": [
      {"type":"labels","value":{"start":0,"end":5,"labels":["VESSEL"]}}
    ]
  },
  "task": {"id": 101, "data": {"text": "TITAN sails to port.", "vertical": "maritime"}},
  "project": {"id": 1, "title": "NER Maritime"}
}
JSON
curl -s -X POST localhost:8081/webhook -H 'content-type: application/json' --data-binary @/tmp/ner_webhook.json
kubectl -n apps logs -l app=annotations-sink --tail=200
```

Expected: logs show validation OK, outbox enqueue, and a commit to `HF_REPO_NER` with path starting `vertical=maritime/schema-`.

5) Test Docling routing

```bash
cat > /tmp/docling_webhook.json <<'JSON'
{
  "action": "ANNOTATION_CREATED",
  "annotation": {
    "result": [
      {"type":"rectanglelabels","value":{"x":10,"y":10,"width":20,"height":10,"labels":["TABLE"]}}
    ]
  },
  "task": {"id": 201, "data": {"text": "(ignored)", "vertical": "maritime"}},
  "project": {"id": 2, "title": "Docling Maritime"}
}
JSON
curl -s -X POST localhost:8081/webhook -H 'content-type: application/json' --data-binary @/tmp/docling_webhook.json
kubectl -n apps logs -l app=annotations-sink --tail=200
```

Expected: commit to `HF_REPO_DOCLING` with `vertical=maritime/...` path.

6) Training Consumption (NER)

Trigger `train-ner.yml` manually or wait for schedule. Confirm steps:
- Shard files are fetched (look for `downloaded shard jsonl files` in logs)
- Normalization writes `local_annotations/ner.jsonl`
- Metrics computed and metrics/*.json pushed to model repo
- ONNX size reported; warning if > 80 MB

7) Label Studio S3 Storage (verify)

- Ensure each Label Studio project has S3 storage configured (SME-managed credentials)
- Confirm that task data contains S3 URLs/paths; the sink will store `source_ref` and `source_tag` for audits

If all pass: mark #118 complete.
