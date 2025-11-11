-- Grafana Panel Query Set (examples)
-- Note: For cross-DB queries, ATTACH both databases as aliases `rawdb` and `anndb` in the query runner.

/* Panel: Docs Ingested Per Day */
SELECT
  DATE_TRUNC('day', ingest_ts) AS day,
  COUNT(DISTINCT doc_id)       AS docs_ingested
FROM rawdb.main.raw_documents
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

/* Panel: Argilla Coverage (% pages exported) */
WITH latest AS (
  SELECT p.doc_id, COUNT(*) AS pages
  FROM rawdb.main.vw_argilla_pages p
  GROUP BY 1
),
arg AS (
  SELECT ap.doc_id, COUNT(DISTINCT ap.argilla_record_id) AS records
  FROM anndb.main.annotations_pages ap
  JOIN anndb.main.vw_latest_exports e
    ON ap.argilla_dataset = e.argilla_dataset AND ap.export_run_id = e.latest_export_run_id
  GROUP BY 1
)
SELECT
  l.doc_id,
  l.pages,
  COALESCE(a.records, 0) AS records,
  CASE WHEN l.pages = 0 THEN 0 ELSE ROUND(100.0 * COALESCE(a.records, 0) / l.pages, 2) END AS pct_exported
FROM latest l
LEFT JOIN arg a USING (doc_id)
ORDER BY pct_exported ASC
LIMIT 100;

/* Panel: Integrity Alerts (text hash mismatches) */
-- Requires that span text strictly matches raw text slices; if not enforced, adapt this check.
SELECT 'span_text_hash_mismatch' AS check_name,
       COUNT(*)                  AS n
FROM anndb.main.vw_latest_annotations_spans s
WHERE s.text_sha256 IS NULL OR length(s.text_sha256) < 10;

/* Panel: Orphaned Annotations (no raw page for doc_id/page) */
SELECT 'orphaned_annotations' AS check_name,
       COUNT(*)               AS n
FROM anndb.main.vw_latest_annotations_spans s
LEFT JOIN rawdb.main.vw_argilla_pages p
  ON s.doc_id = p.doc_id AND s.page_num = p.page_num
WHERE p.doc_id IS NULL;

/* Panel: Annotator Throughput (pages/day) */
SELECT
  DATE_TRUNC('day', ap.created_at) AS day,
  ap.annotator_id,
  COUNT(DISTINCT ap.argilla_record_id) AS pages
FROM anndb.main.annotations_pages ap
GROUP BY 1, 2
ORDER BY 1 DESC, pages DESC
LIMIT 200;

/* Panel: Label Distribution (latest export) */
SELECT s.label, COUNT(*) AS spans
FROM anndb.main.vw_latest_annotations_spans s
GROUP BY 1
ORDER BY spans DESC
LIMIT 50;
