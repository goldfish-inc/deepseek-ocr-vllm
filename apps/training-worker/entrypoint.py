#!/usr/bin/env python3
import os
import io
import json
import pathlib
import subprocess
from datetime import datetime

from huggingface_hub import HfApi, CommitOperationAdd, hf_hub_download, list_repo_files


def log(msg: str):
    print(msg, flush=True)


def env(key: str, default: str = "") -> str:
    v = os.environ.get(key, default)
    if not v:
        log(f"WARN: env {key} is empty")
    return v


def fetch_annotations(token: str, dataset_repo: str, out_dir: pathlib.Path) -> None:
    api = HfApi(token=token)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = list_repo_files(dataset_repo, repo_type="dataset")
    count = 0
    for f in files:
        if f.startswith("annotations/") and f.endswith(".jsonl"):
            p = hf_hub_download(dataset_repo, filename=f, repo_type="dataset", token=token)
            dst = out_dir / pathlib.Path(f).name
            with open(p, "rb") as src, open(dst, "wb") as dstf:
                dstf.write(src.read())
            count += 1
    log(f"Downloaded {count} JSONL files to {out_dir}")


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


def main() -> None:
    log("Training job started")
    hf_token = env("HF_TOKEN")
    dataset_repo = env("HF_DATASET_REPO", "goldfish-inc/oceanid-annotations")
    model_repo = env("HF_MODEL_REPO", "goldfish-inc/oceanid-ner-distilbert")
    ann_count = env("ANNOTATION_COUNT", "0")

    work = pathlib.Path("/workspace")
    anns = work / "local_annotations"
    model_out = work / "models/ner-distilbert"
    onnx_out = work / "distilbert_onnx"
    labels_path = pathlib.Path("/app/labels.json")

    work.mkdir(parents=True, exist_ok=True)

    log("Fetching annotations from HF…")
    fetch_annotations(hf_token, dataset_repo, anns)

    if not anns.exists() or not any(anns.glob("*.jsonl")):
        raise SystemExit("No annotations downloaded; aborting")

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

    log("Training complete.")


if __name__ == "__main__":
    main()
