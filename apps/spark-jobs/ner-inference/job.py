#!/usr/bin/env python3
"""
NER Inference via Label Studio Adapter or Triton (Spark scaffold)

Reads preprocessed Parquet (id, text, text_len) and performs inference either:
1. Per-row via ls-triton-adapter /predict endpoint (default)
2. Micro-batched via Triton /v2/models/ner-distilbert/infer (--batch-mode)

Usage (per-row adapter mode):
  spark-submit --master local[*] apps/spark-jobs/ner-inference/job.py \
    --input /tmp/ner-preproc-parquet \
    --output /tmp/ner-infer-parquet \
    --adapter-url http://ls-triton-adapter.apps.svc.cluster.local:9090

Usage (batch Triton mode):
  spark-submit --master local[*] apps/spark-jobs/ner-inference/job.py \
    --input /tmp/ner-preproc-parquet \
    --output /tmp/ner-infer-parquet \
    --batch-mode \
    --triton-url http://calypso.tail4a0e5.ts.net:8000 \
    --model-path ./models/ner-distilbert \
    --batch-size 8

Notes
- Per-row mode: simple, delegates tokenization to adapter
- Batch mode: tokenizes in Spark, micro-batches to Triton for GPU efficiency
- Set TOKENIZERS_PARALLELISM=false to avoid fork warnings in Spark
"""
import argparse
import json
import os
from urllib import request
from urllib.error import URLError, HTTPError

from pyspark.sql import SparkSession, Row
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, LongType, StringType, ArrayType


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Input Parquet with columns [id, text, text_len]")
    ap.add_argument("--output", required=True, help="Output Parquet directory for predictions")
    ap.add_argument("--batch-mode", action="store_true", help="Use batch Triton inference instead of adapter")
    ap.add_argument("--adapter-url", default="http://ls-triton-adapter.apps.svc.cluster.local:9090",
                    help="Label Studio adapter base URL (per-row mode)")
    ap.add_argument("--triton-url", default="http://calypso.tail4a0e5.ts.net:8000",
                    help="Triton server base URL (batch mode)")
    ap.add_argument("--model-path", default="./models/ner-distilbert",
                    help="Path to model directory with tokenizer and labels.json (batch mode)")
    ap.add_argument("--batch-size", type=int, default=8, help="Micro-batch size for Triton (batch mode)")
    ap.add_argument("--max-seq-length", type=int, default=128, help="Max sequence length for tokenizer (batch mode)")
    ap.add_argument("--timeout", type=int, default=15, help="HTTP timeout seconds")
    ap.add_argument("--repartition", type=int, default=0, help="Repartition to N before inference (0 = no change)")
    return ap.parse_args()


def post_json(url: str, payload: dict, timeout: int) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        return {"error": {"code": f"http_{e.code}", "message": e.read().decode("utf-8", errors="ignore")}}
    except URLError as e:
        return {"error": {"code": "network_error", "message": str(e)}}
    except Exception as e:
        return {"error": {"code": "unexpected_error", "message": str(e)}}


def infer_partition_adapter(iter_rows, adapter_url: str, timeout: int):
    """Per-row inference via ls-triton-adapter /predict endpoint."""
    predict_url = adapter_url.rstrip("/") + "/predict"
    for r in iter_rows:
        rid = r["id"]
        text = r["text"] or ""
        payload = {"text": text}
        resp = post_json(predict_url, payload, timeout)
        yield Row(id=int(rid), text=text, prediction_json=json.dumps(resp, ensure_ascii=False))


def infer_partition_triton(iter_rows, triton_url: str, model_path: str, batch_size: int,
                          max_seq_length: int, timeout: int):
    """Batch inference via Triton /v2/models/ner-distilbert/infer endpoint."""
    # Suppress tokenizer parallelism warnings in Spark
    os.environ["TOKENIZERS_PARALLELISM"] = "false"

    # Load tokenizer and labels once per partition
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    with open(f"{model_path}/labels.json", "r") as f:
        label_map = json.load(f)
    id2label = {int(k): v for k, v in label_map["id2label"].items()}

    infer_url = triton_url.rstrip("/") + "/v2/models/ner-distilbert/infer"

    # Collect rows into batches
    batch = []
    for r in iter_rows:
        batch.append(r)
        if len(batch) >= batch_size:
            yield from _process_batch(batch, tokenizer, id2label, infer_url, max_seq_length, timeout)
            batch = []

    # Process remaining rows
    if batch:
        yield from _process_batch(batch, tokenizer, id2label, infer_url, max_seq_length, timeout)


def _process_batch(rows, tokenizer, id2label, infer_url: str, max_seq_length: int, timeout: int):
    """Tokenize, call Triton, decode predictions."""
    ids = [int(r["id"]) for r in rows]
    texts = [r["text"] or "" for r in rows]

    # Tokenize batch
    encodings = tokenizer(
        texts,
        padding="max_length",
        truncation=True,
        max_length=max_seq_length,
        return_tensors="pt"
    )

    # Prepare Triton input format
    batch_size = len(texts)
    input_ids = encodings["input_ids"].flatten().tolist()
    attention_mask = encodings["attention_mask"].flatten().tolist()

    payload = {
        "inputs": [
            {
                "name": "input_ids",
                "shape": [batch_size, max_seq_length],
                "datatype": "INT64",
                "data": input_ids
            },
            {
                "name": "attention_mask",
                "shape": [batch_size, max_seq_length],
                "datatype": "INT64",
                "data": attention_mask
            }
        ]
    }

    # Call Triton
    resp = post_json(infer_url, payload, timeout)

    if "error" in resp:
        # Return errors for all rows in batch
        for i, (rid, text) in enumerate(zip(ids, texts)):
            yield Row(id=rid, text=text, predictions=[], error=json.dumps(resp["error"]))
        return

    # Unpack logits: shape [batch, seq, num_labels], flattened
    logits_flat = resp["outputs"][0]["data"]
    num_labels = len(id2label)

    # Reshape and decode per sample
    for i, (rid, text) in enumerate(zip(ids, texts)):
        start = i * max_seq_length * num_labels
        sample_logits = logits_flat[start:start + max_seq_length * num_labels]

        # Argmax per token
        predictions = []
        for tok_idx in range(max_seq_length):
            tok_start = tok_idx * num_labels
            tok_logits = sample_logits[tok_start:tok_start + num_labels]
            pred_id = tok_logits.index(max(tok_logits))
            predictions.append(id2label[pred_id])

        # Trim to actual tokens (before padding)
        actual_length = encodings["attention_mask"][i].sum().item()
        predictions = predictions[:actual_length]

        yield Row(id=rid, text=text, predictions=predictions, error=None)


def main():
    args = parse_args()
    app_name = "ner-infer-triton-batch" if args.batch_mode else "ner-infer-adapter"
    spark = (
        SparkSession.builder
        .appName(app_name)
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )

    df = spark.read.parquet(args.input).select("id", "text", "text_len")
    if args.repartition and args.repartition > 0:
        df = df.repartition(args.repartition)

    if args.batch_mode:
        # Batch Triton mode: tokenize in Spark, micro-batch to Triton
        schema = StructType([
            StructField("id", LongType(), False),
            StructField("text", StringType(), True),
            StructField("predictions", ArrayType(StringType()), True),
            StructField("error", StringType(), True),
        ])

        rdd = df.select("id", "text").rdd.mapPartitions(
            lambda it: infer_partition_triton(
                it, args.triton_url, args.model_path, args.batch_size,
                args.max_seq_length, args.timeout
            )
        )
    else:
        # Per-row adapter mode: delegate tokenization to adapter
        schema = StructType([
            StructField("id", LongType(), False),
            StructField("text", StringType(), True),
            StructField("prediction_json", StringType(), True),
        ])

        rdd = df.select("id", "text").rdd.mapPartitions(
            lambda it: infer_partition_adapter(it, args.adapter_url, args.timeout)
        )

    out_df = spark.createDataFrame(rdd, schema=schema)
    out_df.write.mode("overwrite").parquet(args.output)
    spark.stop()


if __name__ == "__main__":
    main()
