#!/usr/bin/env python3
"""
Provision a Label Studio project with:
- Full NER labeling interface generated from configured labels
- Connected ML backend (ls-triton-adapter)

Usage:
  export LABEL_STUDIO_URL=https://label.boathou.se
  export LABEL_STUDIO_PAT=eyJ...  # Personal Access Token (refresh token) for a service account
  export ML_BACKEND_URL=http://ls-triton-adapter.apps.svc.cluster.local:9090
  # Optional: provide NER labels; otherwise falls back to repository labels.json
  export NER_LABELS='["VESSEL_NAME","IMO",...]'

  # By project title
  python3 scripts/provision-ls-project.py --title "SME 2025"

  # Or by project id
  python3 scripts/provision-ls-project.py --id 123

This script uses LS 1.21.0 JWT flows (PAT -> access token) and is intended to
be run by an automation or service account token (stored in ESC), not a personal user token.
"""

import argparse
import json
import os
import sys
from typing import List, Optional

import requests


def get_access_token(ls_url: str, pat: str) -> str:
    r = requests.post(f"{ls_url.rstrip('/')}/api/token/refresh", json={"refresh": pat})
    r.raise_for_status()
    return r.json()["access"]


def load_labels() -> List[str]:
    env = os.getenv("NER_LABELS")
    if env:
        try:
            labels = json.loads(env)
            if isinstance(labels, list) and all(isinstance(x, str) for x in labels):
                return labels
        except Exception:
            pass
    # Fallback to repository labels.json
    repo_labels_path = os.path.join(os.path.dirname(__file__), "..", "labels.json")
    try:
        with open(repo_labels_path, "r") as f:
            data = json.load(f)
            return [item["label"] for item in data.get("labels", [])]
    except Exception as e:
        print(f"Failed to load labels from env or labels.json: {e}", file=sys.stderr)
        return [
            "VESSEL_NAME","IMO","MMSI","IRCS","PORT","DATE","COMPANY","FLAG"
        ]


def build_label_config(labels: List[str]) -> str:
    # Build LS XML config for Text NER
    label_tags = "\n".join([f"      <Label value=\"{l}\"/>" for l in labels])
    xml = f"""
<View>
  <Header value="Document Text"/>
  <Text name="text" value="$text"/>
  <Labels name="ner" toName="text" showInline="true">
{label_tags}
  </Labels>
  <Relations name="rels" toName="text"/>
</View>
""".strip()
    return xml


def find_project(ls_url: str, access_token: str, title: Optional[str], pid: Optional[int]) -> Optional[dict]:
    headers = {"Authorization": f"Bearer {access_token}"}
    if pid:
        r = requests.get(f"{ls_url.rstrip('/')}/api/projects/{pid}", headers=headers)
        if r.status_code == 200:
            return r.json()
        return None
    # By title
    r = requests.get(f"{ls_url.rstrip('/')}/api/projects/", headers=headers)
    r.raise_for_status()
    for p in r.json():
        if p.get("title") == title:
            return p
    return None


def ensure_ml_backend(ls_url: str, access_token: str, project_id: int, backend_url: str) -> None:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    # Already connected?
    r = requests.get(f"{ls_url.rstrip('/')}/api/ml", params={"project": project_id}, headers=headers)
    r.raise_for_status()
    for b in r.json():
        if b.get("url") == backend_url:
            return
    payload = {
        "url": backend_url,
        "project": project_id,
        "title": "Triton Inference Adapter",
        "description": "NER + Docling predictions",
        "is_interactive": True,
    }
    r = requests.post(f"{ls_url.rstrip('/')}/api/ml", headers=headers, json=payload)
    r.raise_for_status()


def apply_label_config(ls_url: str, access_token: str, project_id: int, label_config: str, description: Optional[str]) -> None:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    body = {"label_config": label_config}
    if description:
        body["description"] = description
    r = requests.patch(
        f"{ls_url.rstrip('/')}/api/projects/{project_id}",
        headers=headers,
        json=body,
    )
    r.raise_for_status()


def import_sample_tasks(ls_url: str, access_token: str, project_id: int) -> None:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    sample_tasks = [
        {"data": {"text": "Vessel NEREUS IMO 8819421 arrived at BURELA on 2023-01-01."}},
    ]
    r = requests.post(
        f"{ls_url.rstrip('/')}/api/projects/{project_id}/import",
        headers=headers,
        json=sample_tasks,
    )
    # LS returns 201 or 200 depending on version
    if r.status_code not in (200, 201):
        r.raise_for_status()


def main():
    parser = argparse.ArgumentParser(description="Provision a Label Studio project")
    parser.add_argument("--title", help="Project title")
    parser.add_argument("--id", type=int, help="Project id")
    parser.add_argument("--description", help="Project description", default=None)
    parser.add_argument("--import-sample", action="store_true", help="Import a sample text task to verify predictions")
    args = parser.parse_args()

    ls_url = os.getenv("LABEL_STUDIO_URL") or "http://label-studio.apps.svc.cluster.local:8080"
    pat = os.getenv("LABEL_STUDIO_PAT") or os.getenv("LABEL_STUDIO_API_KEY")
    backend_url = os.getenv("ML_BACKEND_URL") or "http://ls-triton-adapter.apps.svc.cluster.local:9090"
    if not pat:
        print("LABEL_STUDIO_PAT environment variable not set", file=sys.stderr)
        sys.exit(1)

    access_token = get_access_token(ls_url, pat)
    proj = find_project(ls_url, access_token, args.title, args.id)
    if not proj:
        print("Project not found. Provide --title or --id.", file=sys.stderr)
        sys.exit(2)

    project_id = proj["id"]

    # 1) Ensure ML backend
    ensure_ml_backend(ls_url, access_token, project_id, backend_url)

    # 2) Apply labeling interface from labels
    labels = load_labels()
    xml = build_label_config(labels)
    apply_label_config(ls_url, access_token, project_id, xml, args.description)

    if args.import_sample:
        try:
            import_sample_tasks(ls_url, access_token, project_id)
            print("Imported a sample task into the project.")
        except Exception as e:
            print(f"[WARN] Failed to import sample tasks: {e}")

    print(f"Provisioned project {project_id}: ML backend connected and label config updated with {len(labels)} labels")


if __name__ == "__main__":
    main()
