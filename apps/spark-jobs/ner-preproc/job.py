#!/usr/bin/env python3
"""
NER Preprocessing (CPU-first)
- Read JSONL shards with Label Studio-like records
- Extract `text`, compute `text_len`, add monotonic `id`
- Write Parquet for downstream training/inference

Usage (local CPU):
  spark-submit --master local[*] apps/spark-jobs/ner-preproc/job.py \
    --input apps/ner-training/data/synthetic_train.jsonl \
    --output /tmp/ner-preproc-parquet

Notes:
- Keep this job lightweight (no heavy ML deps). Tokenization belongs in model code.
"""
import argparse
from pyspark.sql import SparkSession
from pyspark.sql import functions as F


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to JSONL file or directory of JSONL")
    ap.add_argument("--output", required=True, help="Output Parquet directory")
    return ap.parse_args()


def extract_text(col):
    # text can be at root or nested under data.text
    return F.coalesce(F.col("text"), F.col("data.text"), F.lit(""))


def main():
    args = parse_args()
    spark = (
        SparkSession.builder
        .appName("ner-preproc")
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )

    df = spark.read.json(args.input, multiLine=False)
    df = df.withColumn("text", extract_text(F.col("text"))).select("text")
    df = df.withColumn("text", F.col("text").cast("string")).fillna({"text": ""})
    df = df.withColumn("text_len", F.length(F.col("text")))
    df = df.withColumn("id", F.monotonically_increasing_id())

    out = df.select("id", "text", "text_len")
    (
        out.coalesce(1)
        .write.mode("overwrite")
        .parquet(args.output)
    )

    spark.stop()


if __name__ == "__main__":
    main()
