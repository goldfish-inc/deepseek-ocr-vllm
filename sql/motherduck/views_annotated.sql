-- Views for md_annotated

-- Latest export per dataset
CREATE OR REPLACE VIEW vw_latest_exports AS
SELECT argilla_dataset, MAX(export_run_id) AS latest_export_run_id
FROM annotations_exports
GROUP BY argilla_dataset;

-- Latest spans per dataset (resolves to most recent export)
CREATE OR REPLACE VIEW vw_latest_annotations_spans AS
SELECT s.*
FROM annotations_spans s
JOIN vw_latest_exports e
  ON s.argilla_dataset = e.argilla_dataset
 AND s.export_run_id   = e.latest_export_run_id;
