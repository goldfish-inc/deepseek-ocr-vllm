package main

// Scaffold for CSV/XLSX prelabel integration.
// Intention: parse S3 CSV/XLSX, normalize rows to text, batch NER via Triton,
// and import tasks + predictions into Label Studio.

// NOTE: This file is not wired yet. Hooking it up requires LS API URL/token
// in adapter config and careful import chunking to keep LS responsive.

// Suggested env variables (add to Config when wiring):
//  LS_API_URL   e.g., https://label.boathou.se
//  LS_API_TOKEN personal access token with project write scope

// Steps:
// 1. Download s3://bucket/key (already supported in adapter for PDFs)
// 2. If .csv: use encoding/csv to iterate rows; if .xlsx: use a reader (e.g., excelize)
// 3. Build normalized row text (deterministic key=value pairs) + lineage (sha256, row index)
// 4. Batch rows (8–16) to Triton via makeTritonRequest
// 5. Convert logits → labels and LS spans (offsets) for each row text
// 6. Use LS import API to create row tasks with data.text and attach predictions
// 7. Return an acknowledgement in /predict_ls (or log outcome) so LS users can open row tasks and see prelabels.
