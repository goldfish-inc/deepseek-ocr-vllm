# NER Preprocessing Spark Job (Scaffold)

Goal
- Prepare large JSONL shards (Label Studio style) into clean Parquet datasets for training/inference pipelines.
- CPU-first; can run on a single node (`local[*]`) or Spark cluster. Optional GPU acceleration via RAPIDS can be added later.

Inputs
- JSONL files containing records like: `{ "text": "...", ... }`
- The job extracts `text`, computes simple metadata, and writes Parquet.

Outputs
- Parquet with columns: `id` (monotonic), `text`, `text_len`.

Run (local)
```bash
# Requires Apache Spark available in PATH (spark-submit)
INPUT=apps/ner-training/data/synthetic_train.jsonl \
OUTPUT=/tmp/ner-preproc-parquet \
master=local[*] \
  spark-submit \
    --master ${master:-local[*]} \
    apps/spark-jobs/ner-preproc/job.py \
    --input "$INPUT" \
    --output "$OUTPUT"
```

Batch Inference (Triton)
```bash
# CPU local
make spark-infer-batch \
  INPUT=/tmp/ner-preproc-parquet \
  OUTPUT=/tmp/ner-infer-batch \
  TRITON_URL=http://calypso.tail4a0e5.ts.net:8000 \
  MODEL_PATH=./models/ner-distilbert \
  BATCH_SIZE=8

# Adapter mode (per-row HTTP) with structured spans
make spark-infer \
  INPUT=/tmp/ner-preproc-parquet \
  OUTPUT=/tmp/ner-infer-adapter \
  STRUCTURED=true
```

Run (cluster)
- Use your Spark cluster submit command, replacing `--master` and adding any resource configs (e.g., executor memory, cores).

Extending
- Add a second stage to micro-batch texts and call Triton for inference (HTTP/gRPC). Keep batch size aligned with model max sequence length and Triton dynamic batching.
- When enabling RAPIDS:
  - Add plugin config: `spark.plugins=com.nvidia.spark.SQLPlugin` and relevant `spark.executor.resource.gpu.*` settings.
  - Match CUDA and RAPIDS versions to your GPU driver and Spark version.
  - Use `apps/spark-jobs/conf/rapids.conf` as a starting properties file.

Notes
- This scaffold avoids heavy ML deps and focuses on ETL. Tokenization/inference should remain in dedicated services or follow-up jobs.
