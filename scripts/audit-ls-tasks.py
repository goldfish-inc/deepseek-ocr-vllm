#!/usr/bin/env python3
"""
Audit Label Studio tasks for references to deprecated document-extraction-service.

Scans all tasks across all projects looking for references to the old extraction service
in task data, predictions, or annotations. Outputs CSV report of findings.

Usage:
    export LS_URL="https://label.boathou.se"
    export LS_PAT="your-label-studio-personal-access-token"
    python scripts/audit-ls-tasks.py [--output audit-results.csv]

Exit codes:
    0 - No deprecated references found
    1 - Found tasks with deprecated references
    2 - Script error (missing credentials, API failure)
"""

import sys
import os
import csv
import argparse
import requests
from typing import List, Dict, Any, Set
import json

# Configuration
LS_URL = os.getenv("LS_URL", "https://label.boathou.se")
LS_PAT = os.getenv("LS_PAT")

# Deprecated service patterns to search for
DEPRECATED_PATTERNS = [
    "document-extraction-service",
    "doc-extract-service",
    "document-extraction",
    # Add any other old service names here
]


def verify_credentials() -> None:
    """Verify required environment variables are set."""
    if not LS_PAT:
        print("❌ Error: LS_PAT environment variable not set", file=sys.stderr)
        print("   Set it with: export LS_PAT='your-label-studio-token'", file=sys.stderr)
        sys.exit(2)


def exchange_token() -> str:
    """Exchange refresh token for short-lived access token."""
    try:
        response = requests.post(
            f"{LS_URL}/api/token/refresh",
            json={"refresh": LS_PAT},
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        response.raise_for_status()
        return response.json()["access"]
    except requests.exceptions.RequestException as e:
        print(f"❌ Error exchanging token: {e}", file=sys.stderr)
        sys.exit(2)


def get_headers() -> Dict[str, str]:
    """Return authorization headers for Label Studio API."""
    access_token = exchange_token()
    return {"Authorization": f"Bearer {access_token}"}


def fetch_projects() -> List[Dict[str, Any]]:
    """Fetch all projects from Label Studio."""
    try:
        response = requests.get(f"{LS_URL}/api/projects", headers=get_headers(), timeout=30)
        response.raise_for_status()
        data = response.json()
        # Handle paginated response
        if isinstance(data, dict) and "results" in data:
            return data["results"]
        return data
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching projects: {e}", file=sys.stderr)
        sys.exit(2)


def fetch_tasks(project_id: int) -> List[Dict[str, Any]]:
    """Fetch all tasks for a specific project."""
    try:
        # Fetch with pagination
        tasks = []
        page = 1
        per_page = 100

        while True:
            response = requests.get(
                f"{LS_URL}/api/projects/{project_id}/tasks",
                params={"page": page, "page_size": per_page},
                headers=get_headers(),
                timeout=30
            )
            response.raise_for_status()
            page_tasks = response.json()

            if not page_tasks:
                break

            tasks.extend(page_tasks)
            page += 1

            # Safety limit
            if page > 1000:
                print(f"⚠️  Warning: Hit pagination limit for project {project_id}", file=sys.stderr)
                break

        return tasks
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Warning: Failed to fetch tasks for project {project_id}: {e}", file=sys.stderr)
        return []


def contains_deprecated_reference(obj: Any) -> Set[str]:
    """
    Recursively search object for deprecated service references.
    Returns set of found patterns.
    """
    found_patterns = set()

    if isinstance(obj, dict):
        for key, value in obj.items():
            # Check key
            key_lower = str(key).lower()
            for pattern in DEPRECATED_PATTERNS:
                if pattern in key_lower:
                    found_patterns.add(pattern)

            # Recurse into value
            found_patterns.update(contains_deprecated_reference(value))

    elif isinstance(obj, list):
        for item in obj:
            found_patterns.update(contains_deprecated_reference(item))

    elif isinstance(obj, str):
        obj_lower = obj.lower()
        for pattern in DEPRECATED_PATTERNS:
            if pattern in obj_lower:
                found_patterns.add(pattern)

    return found_patterns


def audit_task(task: Dict[str, Any], project_id: int) -> Dict[str, Any] | None:
    """
    Audit a single task for deprecated references.
    Returns audit result dict if references found, None otherwise.
    """
    task_id = task.get("id")
    found_patterns = set()

    # Check task data
    if "data" in task:
        found_patterns.update(contains_deprecated_reference(task["data"]))

    # Check predictions
    if "predictions" in task:
        found_patterns.update(contains_deprecated_reference(task["predictions"]))

    # Check annotations
    if "annotations" in task:
        found_patterns.update(contains_deprecated_reference(task["annotations"]))

    if found_patterns:
        return {
            "project_id": project_id,
            "task_id": task_id,
            "patterns_found": ", ".join(sorted(found_patterns)),
            "task_url": f"{LS_URL}/projects/{project_id}/data?task={task_id}",
        }

    return None


def main() -> None:
    """Main audit logic."""
    parser = argparse.ArgumentParser(description="Audit Label Studio tasks for deprecated service references")
    parser.add_argument("--output", default="audit-results.csv", help="Output CSV file path")
    args = parser.parse_args()

    verify_credentials()

    print(f"🔍 Auditing tasks at {LS_URL}")
    print(f"   Looking for patterns: {', '.join(DEPRECATED_PATTERNS)}")
    print()

    projects = fetch_projects()
    print(f"📊 Found {len(projects)} projects to audit")
    print()

    results = []
    total_tasks = 0

    for project in projects:
        project_id = project["id"]
        project_title = project.get("title", f"Project {project_id}")

        print(f"🔎 Auditing project [{project_id}] {project_title}...", end=" ")
        sys.stdout.flush()

        tasks = fetch_tasks(project_id)
        total_tasks += len(tasks)

        project_issues = 0
        for task in tasks:
            audit_result = audit_task(task, project_id)
            if audit_result:
                results.append(audit_result)
                project_issues += 1

        if project_issues > 0:
            print(f"❌ {project_issues} tasks with issues")
        else:
            print(f"✅ Clean")

    print()
    print("=" * 60)

    if results:
        # Write CSV report
        with open(args.output, "w", newline="") as csvfile:
            fieldnames = ["project_id", "task_id", "patterns_found", "task_url"]
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)

        print(f"❌ FAIL: Found {len(results)} tasks with deprecated references")
        print(f"   Report written to: {args.output}")
        print()
        print("Summary:")
        for result in results[:10]:  # Show first 10
            print(f"  - Project {result['project_id']}, Task {result['task_id']}: {result['patterns_found']}")
        if len(results) > 10:
            print(f"  ... and {len(results) - 10} more (see CSV)")
        print()
        print("Resolution:")
        print("  1. Review affected tasks in Label Studio UI")
        print("  2. Remove or update references to old extraction service")
        print("  3. Re-run audit to verify cleanup")
        sys.exit(1)
    else:
        print(f"✅ PASS: Audited {total_tasks} tasks across {len(projects)} projects")
        print(f"   No deprecated service references found")
        sys.exit(0)


if __name__ == "__main__":
    main()
