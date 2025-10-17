#!/usr/bin/env python3
"""
Verify ML backends attached to all Label Studio projects.

Checks that all active projects have the Triton adapter ML backend configured.
Reports any projects missing the expected backend.

Usage:
    export LS_URL="https://label.boathou.se"
    export LS_PAT="your-label-studio-personal-access-token"
    python scripts/verify-ml-backends.py

Exit codes:
    0 - All projects configured correctly
    1 - Some projects missing Triton backend
    2 - Script error (missing credentials, API failure)
"""

import sys
import os
import requests
from typing import List, Dict, Any

# Configuration
LS_URL = os.getenv("LS_URL", "https://label.boathou.se")
LS_PAT = os.getenv("LS_PAT")
EXPECTED_BACKEND = "http://ls-triton-adapter.apps.svc.cluster.local:9090"

# Also accept these as valid (for backwards compatibility during migration)
VALID_BACKENDS = [
    EXPECTED_BACKEND,
    "http://ls-triton-adapter.apps:9090",  # Short form
    "http://ls-triton-adapter:9090",  # Shortest form (assumes same namespace)
]


def verify_credentials() -> None:
    """Verify required environment variables are set."""
    if not LS_PAT:
        print("❌ Error: LS_PAT environment variable not set", file=sys.stderr)
        print("   Set it with: export LS_PAT='your-label-studio-token'", file=sys.stderr)
        sys.exit(2)


def get_headers() -> Dict[str, str]:
    """Return authorization headers for Label Studio API."""
    return {"Authorization": f"Token {LS_PAT}"}


def fetch_projects() -> List[Dict[str, Any]]:
    """Fetch all projects from Label Studio."""
    try:
        response = requests.get(f"{LS_URL}/api/projects", headers=get_headers(), timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching projects: {e}", file=sys.stderr)
        sys.exit(2)


def fetch_ml_backends(project_id: int) -> List[Dict[str, Any]]:
    """Fetch ML backends for a specific project."""
    try:
        response = requests.get(
            f"{LS_URL}/api/ml",
            params={"project": project_id},
            headers=get_headers(),
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Warning: Failed to fetch backends for project {project_id}: {e}", file=sys.stderr)
        return []


def has_triton_backend(backends: List[Dict[str, Any]]) -> bool:
    """Check if project has Triton adapter backend configured."""
    for backend in backends:
        backend_url = backend.get("url", "")
        if backend_url in VALID_BACKENDS:
            return True
    return False


def main() -> None:
    """Main verification logic."""
    verify_credentials()

    print(f"🔍 Verifying ML backends for Label Studio at {LS_URL}")
    print(f"   Expected backend: {EXPECTED_BACKEND}")
    print()

    projects = fetch_projects()
    print(f"📊 Found {len(projects)} total projects")
    print()

    missing_backend = []
    configured_backend = []
    no_backends = []

    for project in projects:
        project_id = project["id"]
        project_title = project.get("title", f"Project {project_id}")

        backends = fetch_ml_backends(project_id)

        if not backends:
            no_backends.append((project_id, project_title))
        elif has_triton_backend(backends):
            configured_backend.append((project_id, project_title))
        else:
            # Has backends but not Triton
            backend_urls = [b.get("url", "unknown") for b in backends]
            missing_backend.append((project_id, project_title, backend_urls))

    # Print results
    if configured_backend:
        print(f"✅ {len(configured_backend)} projects with Triton backend:")
        for pid, title in configured_backend:
            print(f"   - [{pid}] {title}")
        print()

    if no_backends:
        print(f"⚠️  {len(no_backends)} projects with NO ML backends:")
        for pid, title in no_backends:
            print(f"   - [{pid}] {title}")
        print()

    if missing_backend:
        print(f"❌ {len(missing_backend)} projects missing Triton backend:")
        for pid, title, urls in missing_backend:
            print(f"   - [{pid}] {title}")
            print(f"     Current backends: {', '.join(urls)}")
        print()

    # Summary
    print("=" * 60)
    if missing_backend or no_backends:
        total_issues = len(missing_backend) + len(no_backends)
        print(f"❌ FAIL: {total_issues} projects need Triton backend configuration")
        print()
        print("Resolution:")
        print(f"  1. Use project-bootstrapper to attach backends automatically")
        print(f"  2. Or manually add via Label Studio UI: Settings → Machine Learning")
        print(f"     URL: {EXPECTED_BACKEND}")
        sys.exit(1)
    else:
        print(f"✅ PASS: All {len(projects)} projects have Triton backend configured")
        sys.exit(0)


if __name__ == "__main__":
    main()
