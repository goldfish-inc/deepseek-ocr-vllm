#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.request
from typing import Optional, List


def http(method: str, url: str, headers=None, data=None):
    headers = headers or {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return e.code, body


def access_token(ls_url: str, pat: str) -> str:
    payload = json.dumps({"refresh": pat}).encode("utf-8")
    code, body = http(
        "POST", f"{ls_url.rstrip('/')}/api/token/refresh",
        headers={"Content-Type": "application/json"}, data=payload)
    if code != 200:
        print(f"Token refresh failed: {code} {body}", file=sys.stderr)
        sys.exit(2)
    return json.loads(body)["access"]


def load_labels() -> List[str]:
    env = os.getenv("NER_LABELS")
    if env:
        try:
            arr = json.loads(env)
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except Exception:
            pass
    path = os.path.join(os.path.dirname(__file__), "..", "labels.json")
    try:
        with open(path, "r") as f:
            data = json.load(f)
            return [x["label"] for x in data.get("labels", [])]
    except Exception:
        return ["VESSEL_NAME","IMO","MMSI","IRCS","PORT","DATE","COMPANY","FLAG"]


def label_config_xml(labels: List[str]) -> str:
    label_tags = "\n".join([f"      <Label value=\"{l}\"/>" for l in labels])
    return (
        "<View>\n"
        "  <Header value=\"Document Text\"/>\n"
        "  <Text name=\"text\" value=\"$text\"/>\n"
        "  <Labels name=\"label\" toName=\"text\" showInline=\"true\">\n"
        f"{label_tags}\n"
        "  </Labels>\n"
        "  <Relations name=\"rels\" toName=\"text\"/>\n"
        "</View>"
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--title", required=True)
    p.add_argument("--description", default=None)
    args = p.parse_args()

    ls_url = os.getenv("LABEL_STUDIO_URL") or "https://label.boathou.se"
    pat = os.getenv("LABEL_STUDIO_PAT")
    backend_url = os.getenv("ML_BACKEND_URL") or "http://ls-triton-adapter.apps.svc.cluster.local:9090"
    if not pat:
        print("LABEL_STUDIO_PAT not set", file=sys.stderr)
        sys.exit(1)

    token = access_token(ls_url, pat)
    auth = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Find project
    code, body = http("GET", f"{ls_url.rstrip('/')}/api/projects/", headers=auth)
    if code != 200:
        print(f"List projects failed: {code} {body}", file=sys.stderr)
        sys.exit(2)
    pid = None
    for proj in json.loads(body):
        if proj.get("title") == args.title:
            pid = proj.get("id")
            break
    if not pid:
        print("Project not found: " + args.title, file=sys.stderr)
        sys.exit(3)

    # Ensure ML backend
    code, body = http("GET", f"{ls_url.rstrip('/')}/api/ml?project={pid}", headers=auth)
    if code != 200:
        print(f"List ML backends failed: {code} {body}", file=sys.stderr)
        sys.exit(4)
    exists = any(b.get("url") == backend_url for b in json.loads(body))
    if not exists:
        payload = json.dumps({
            "url": backend_url, "project": pid,
            "title": "Triton Inference Adapter",
            "description": "NER + Docling predictions",
            "is_interactive": True,
        }).encode("utf-8")
        code, body = http("POST", f"{ls_url.rstrip('/')}/api/ml", headers=auth, data=payload)
        if code not in (200, 201):
            print(f"Add ML backend failed: {code} {body}", file=sys.stderr)
            sys.exit(5)

    # Apply labeling interface
    labels = load_labels()
    xml = label_config_xml(labels)
    patch_body = {"label_config": xml}
    if args.description:
        patch_body["description"] = args.description
    code, body = http("PATCH", f"{ls_url.rstrip('/')}/api/projects/{pid}", headers=auth,
                      data=json.dumps(patch_body).encode("utf-8"))
    if code not in (200, 201):
        print(f"Patch project failed: {code} {body}", file=sys.stderr)
        sys.exit(6)

    # Import a sample text task
    sample = [{"data": {"text": "Vessel NEREUS IMO 8819421 arrived at BURELA on 2023-01-01."}}]
    code, body = http("POST", f"{ls_url.rstrip('/')}/api/projects/{pid}/import", headers=auth,
                      data=json.dumps(sample).encode("utf-8"))
    if code not in (200, 201):
        print(f"[WARN] Import sample failed: {code} {body}")

    print(f"Provisioned project {pid}: ML backend connected and label config updated with {len(labels)} labels")


if __name__ == "__main__":
    main()
