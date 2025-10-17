#!/usr/bin/env python3
"""
NER Inference via Label Studio Adapter (Spark scaffold)

Reads preprocessed Parquet (id, text, text_len) and calls the in-cluster
ls-triton-adapter /predict endpoint per row. Results are stored as JSON.

Usage (local CPU):
  spark-submit --master local[*] apps/spark-jobs/ner-inference/job.py \
    --input /tmp/ner-preproc-parquet \
    --output /tmp/ner-infer-parquet \
    --adapter-url http://ls-triton-adapter.apps.svc.cluster.local:9090

Notes
- This avoids tokenization in Spark by delegating to the adapter. For true
  micro-batching to Triton, implement a tokenizer and group requests.
"""
import argparse
import json
from urllib import request
from urllib.error import URLError, HTTPError

from pyspark.sql import SparkSession, Row
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, LongType, StringType


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Input Parquet with columns [id, text, text_len]")
    ap.add_argument("--output", required=True, help="Output Parquet directory for predictions")
    ap.add_argument("--adapter-url", default="http://ls-triton-adapter.apps.svc.cluster.local:9090",
                    help="Label Studio adapter base URL")
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


def infer_partition(iter_rows, adapter_url: str, timeout: int):
    predict_url = adapter_url.rstrip("/") + "/predict"
    for r in iter_rows:
        rid = r["id"]
        text = r["text"] or ""
        payload = {"text": text}
        resp = post_json(predict_url, payload, timeout)
        yield Row(id=int(rid), text=text, prediction_json=json.dumps(resp, ensure_ascii=False))


def main():
    args = parse_args()
    spark = (
        SparkSession.builder
        .appName("ner-infer-adapter")
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )

    df = spark.read.parquet(args.input).select("id", "text", "text_len")
    if args.repartition and args.repartition > 0:
        df = df.repartition(args.repartition)

    schema = StructType([
        StructField("id", LongType(), False),
        StructField("text", StringType(), True),
        StructField("prediction_json", StringType(), True),
    ])

    rdd = df.select("id", "text").rdd.mapPartitions(
        lambda it: infer_partition(it, args.adapter_url, args.timeout)
    )
    out_df = spark.createDataFrame(rdd, schema=schema)
    out_df.write.mode("overwrite").parquet(args.output)
    spark.stop()


if __name__ == "__main__":
    main()
