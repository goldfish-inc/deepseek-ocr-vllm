-- Recent document stats (start here)
SELECT *
FROM stage.v_document_processing_stats
ORDER BY last_processed_at DESC NULLS LAST
LIMIT 50;

-- NER spans for a specific document (replace :document_id)
SELECT e.label, e.value, e.confidence, e.updated_at
FROM stage.extractions e
WHERE e.document_id = :document_id
ORDER BY e.updated_at DESC;

-- CSV/XLSX cleaned cells needing review
SELECT document_id, row_index, column_name, raw_value, cleaned_value, confidence
FROM stage.csv_extractions
WHERE needs_review = true
ORDER BY confidence ASC, created_at ASC
LIMIT 200;

-- Your corrections (training data for the model)
SELECT corrected_value, correction_type, annotator, annotated_at
FROM stage.training_corpus
ORDER BY annotated_at DESC
LIMIT 200;
