#!/usr/bin/env python3
"""Training worker for in-cluster Active Learning."""
import os
import io
import json
import pathlib
import subprocess
import time
from datetime import datetime

import requests
from huggingface_hub import HfApi, CommitOperationAdd, hf_hub_download, list_repo_files


def log(msg: str):
    print(msg, flush=True)


def env(key: str, default: str = "") -> str:
    v = os.environ.get(key, default)
    if not v:
        log(f"WARN: env {key} is empty")
    return v


def fetch_annotations(token: str, dataset_repo: str, shards_dir: pathlib.Path) -> None:
    api = HfApi(token=token)
    shards_dir.mkdir(parents=True, exist_ok=True)
    files = list_repo_files(dataset_repo, repo_type="dataset")
    count = 0
    for f in files:
        if (f.startswith("vertical=") or f.startswith("schema-")) and f.endswith(".jsonl"):
            p = hf_hub_download(dataset_repo, filename=f, repo_type="dataset", token=token)
            dst = shards_dir / pathlib.Path(f.replace("/","__")).name
            with open(p, "rb") as src, open(dst, "wb") as dstf:
                dstf.write(src.read())
            count += 1
    log(f"Downloaded {count} JSONL shard files to {shards_dir}")


def run(cmd: list[str]) -> None:
    log("+ " + " ".join(cmd))
    subprocess.check_call(cmd)


def publish_model(token: str, model_repo: str, path: pathlib.Path) -> None:
    api = HfApi(token=token)
    api.create_repo(repo_id=model_repo, repo_type="model", private=True, exist_ok=True)
    bin_data = path.read_bytes()
    op = CommitOperationAdd(path_in_repo="onnx/model.onnx", path_or_fileobj=io.BytesIO(bin_data))
    api.create_commit(
        repo_id=model_repo,
        repo_type="model",
        operations=[op],
        commit_message=f"Update ONNX {datetime.utcnow().isoformat()}Z",
    )
    log(f"Published ONNX to {model_repo}")


def reload_triton_model(triton_url: str, model_name: str, max_retries: int = 3) -> None:
    """Reload model in Triton using Model Control API (EXPLICIT mode).

    This completes the Active Learning loop by updating the serving model
    after training completes.
    """
    log(f"Reloading Triton model '{model_name}' at {triton_url}")

    # Step 1: Unload current model (graceful)
    unload_url = f"{triton_url}/v2/repository/models/{model_name}/unload"
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(unload_url, timeout=30)
            if resp.status_code == 200:
                log(f"Model '{model_name}' unloaded successfully")
                break
            elif resp.status_code == 404:
                log(f"Model '{model_name}' not loaded (first deployment?), skipping unload")
                break
            else:
                log(f"Unload attempt {attempt}/{max_retries} failed: {resp.status_code} {resp.text}")
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
        except Exception as e:
            log(f"Unload attempt {attempt}/{max_retries} error: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)

    # Step 2: Load updated model
    load_url = f"{triton_url}/v2/repository/models/{model_name}/load"
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(load_url, timeout=60)
            if resp.status_code == 200:
                log(f"Model '{model_name}' loaded successfully - Active Learning loop complete")
                return
            else:
                log(f"Load attempt {attempt}/{max_retries} failed: {resp.status_code} {resp.text}")
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
        except Exception as e:
            log(f"Load attempt {attempt}/{max_retries} error: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)

    # If we get here, all retries failed
    raise RuntimeError(f"Failed to reload Triton model '{model_name}' after {max_retries} attempts")


def main() -> None:
    log("Training job started")
    hf_token = env("HF_TOKEN")
    dataset_repo = env("HF_DATASET_REPO_NER", "") or env("HF_DATASET_REPO", "goldfish-inc/oceanid-annotations")
    model_repo = env("HF_MODEL_REPO", "goldfish-inc/oceanid-ner-distilbert")
    ann_count = env("ANNOTATION_COUNT", "0")
    triton_url = env("TRITON_URL", "http://triton.triton.svc.cluster.local:8000")
    model_name = env("TRITON_MODEL_NAME", "ner-distilbert")

    work = pathlib.Path("/workspace")
    shards = work / "shards"
    anns = work / "local_annotations"
    model_out = work / "models/ner-distilbert"
    onnx_out = work / "distilbert_onnx"
    labels_path = pathlib.Path("/app/labels.json")

    work.mkdir(parents=True, exist_ok=True)

    log("Fetching annotations from HF…")
    fetch_annotations(hf_token, dataset_repo, shards)

    if not shards.exists() or not any(shards.glob("*.jsonl")):
        raise SystemExit("No annotations downloaded; aborting")

    # Normalize shards into training format
    anns.mkdir(parents=True, exist_ok=True)
    run([
        "python",
        "/app/normalize_ner_from_outbox.py",
        "--in",
        str(shards),
        "--out",
        str(anns),
    ])

    log("Starting NER training…")
    run([
        "python",
        "/app/ner_train.py",
        "--labels",
        str(labels_path),
        "--data-dir",
        str(anns),
        "--out",
        str(model_out),
    ])

    log("Exporting ONNX…")
    # Determine label count from labels.json
    try:
        labels = json.loads(labels_path.read_text())
        num_labels = str(len(labels))
    except Exception:
        num_labels = "63"  # safe default
    run([
        "bash",
        "/app/export_onnx.sh",
        str(model_out),
        str(onnx_out),
        num_labels,
    ])

    onnx_path = onnx_out / "model.onnx"
    if not onnx_path.exists():
        raise SystemExit("ONNX export failed: model.onnx missing")

    log("Publishing ONNX to HF…")
    publish_model(hf_token, model_repo, onnx_path)

    log("Reloading model in Triton…")
    try:
        reload_triton_model(triton_url, model_name)
    except Exception as e:
        log(f"WARN: Triton reload failed: {e}")
        log("Model published to HuggingFace but not loaded in Triton - manual reload required")

    log("Training complete.")


if __name__ == "__main__":
    main()
