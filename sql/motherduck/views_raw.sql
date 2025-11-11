-- Views for md_raw_ocr

-- Latest run per document
CREATE OR REPLACE VIEW vw_latest_runs AS
SELECT doc_id, MAX(run_id) AS latest_run_id
FROM raw_documents
GROUP BY doc_id;

-- Pages for Argilla push (latest OCR run only)
CREATE OR REPLACE VIEW vw_argilla_pages AS
SELECT p.doc_id,
       p.page_num,
       p.text,
       p.text_sha256
FROM raw_pages p
JOIN vw_latest_runs r
  ON p.doc_id = r.doc_id AND p.run_id = r.latest_run_id;
