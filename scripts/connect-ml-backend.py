#!/usr/bin/env python3
"""
Connect ML Backend to Label Studio Project

This script connects the ls-triton-adapter ML backend to a Label Studio project
programmatically using the Label Studio SDK and REST API.

Usage:
    export LABEL_STUDIO_URL=https://label.boathou.se
    export LABEL_STUDIO_API_KEY=your_api_key
    python3 scripts/connect-ml-backend.py

Requirements:
    pip install label-studio-sdk requests
"""

import os
import sys
import requests
from label_studio_sdk.client import LabelStudio

# Configuration
LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "https://label.boathou.se")
LABEL_STUDIO_API_KEY = os.getenv("LABEL_STUDIO_API_KEY")
ML_BACKEND_URL = os.getenv("ML_BACKEND_URL", "http://ls-triton-adapter.apps.svc.cluster.local:9090")
PROJECT_NAME = os.getenv("PROJECT_NAME", "SME 2025")

def main():
    """Connect ML backend to Label Studio project."""

    # Validate required environment variables
    if not LABEL_STUDIO_API_KEY:
        print("❌ Error: LABEL_STUDIO_API_KEY environment variable not set", file=sys.stderr)
        print("\nGet your API key from Label Studio:")
        print("1. Navigate to https://label.boathou.se")
        print("2. Go to Account & Settings → Access Token")
        print("3. Copy your token and export it:")
        print("   export LABEL_STUDIO_API_KEY='your_token_here'")
        sys.exit(1)

    print(f"🔗 Connecting to Label Studio at {LABEL_STUDIO_URL}")

    # Initialize Label Studio client
    try:
        ls = LabelStudio(
            base_url=LABEL_STUDIO_URL,
            api_key=LABEL_STUDIO_API_KEY
        )
        print("✅ Connected to Label Studio")
    except Exception as e:
        print(f"❌ Failed to connect to Label Studio: {e}", file=sys.stderr)
        sys.exit(1)

    # Find the project by name
    print(f"\n🔍 Looking for project '{PROJECT_NAME}'...")
    try:
        projects = ls.projects.list()
        project = None
        for p in projects:
            if p.title == PROJECT_NAME:
                project = p
                break

        if not project:
            print(f"❌ Project '{PROJECT_NAME}' not found", file=sys.stderr)
            print("\nAvailable projects:")
            for p in projects:
                print(f"  - {p.title} (ID: {p.id})")
            sys.exit(1)

        print(f"✅ Found project '{PROJECT_NAME}' (ID: {project.id})")
    except Exception as e:
        print(f"❌ Failed to list projects: {e}", file=sys.stderr)
        sys.exit(1)

    # Connect ML backend using REST API
    # The SDK doesn't have a direct method, so we use the API endpoint
    print(f"\n🤖 Connecting ML backend: {ML_BACKEND_URL}")

    headers = {
        "Authorization": f"Token {LABEL_STUDIO_API_KEY}",
        "Content-Type": "application/json"
    }

    # Check if backend already exists
    try:
        response = requests.get(
            f"{LABEL_STUDIO_URL}/api/ml",
            headers=headers,
            params={"project": project.id}
        )
        response.raise_for_status()
        existing_backends = response.json()

        # Check if our backend is already connected
        backend_exists = False
        for backend in existing_backends:
            if backend.get("url") == ML_BACKEND_URL:
                backend_exists = True
                print(f"ℹ️  ML backend already connected (ID: {backend['id']})")
                break

        if not backend_exists:
            # Add ML backend
            payload = {
                "url": ML_BACKEND_URL,
                "project": project.id,
                "title": "Triton Inference Backend",
                "description": "FastAPI adapter for Triton (DistilBERT NER + Docling Granite)",
                "is_interactive": True  # Enable interactive pre-annotations
            }

            response = requests.post(
                f"{LABEL_STUDIO_URL}/api/ml",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            backend = response.json()
            print(f"✅ ML backend connected successfully (ID: {backend['id']})")

        # Enable auto-annotation in project settings
        print("\n⚙️  Updating project settings...")
        project_update = {
            "show_collab_predictions": True,  # Show predictions in UI
            "model_version": "latest"
        }

        response = requests.patch(
            f"{LABEL_STUDIO_URL}/api/projects/{project.id}",
            headers=headers,
            json=project_update
        )
        response.raise_for_status()
        print("✅ Project settings updated")

        # Test ML backend health
        print(f"\n🏥 Testing ML backend health...")
        try:
            # Try internal URL first (if running in cluster)
            health_response = requests.get(
                f"{ML_BACKEND_URL}/health",
                timeout=5
            )
            health_response.raise_for_status()
            print("✅ ML backend is healthy and responding")
        except requests.exceptions.RequestException:
            print("⚠️  Could not reach ML backend directly (may require cluster access)")
            print("   Backend will be accessible from Label Studio pod")

        print("\n" + "="*60)
        print("✅ ML Backend Connection Complete!")
        print("="*60)
        print(f"\nProject: {PROJECT_NAME} (ID: {project.id})")
        print(f"ML Backend: {ML_BACKEND_URL}")
        print(f"\nNext steps:")
        print(f"1. Open your project: {LABEL_STUDIO_URL}/projects/{project.id}")
        print(f"2. Import or create tasks")
        print(f"3. Enable 'Auto-Annotation' in project settings")
        print(f"4. Click 'Get Predictions' to pre-label tasks")

    except requests.exceptions.HTTPError as e:
        print(f"❌ API request failed: {e}", file=sys.stderr)
        if hasattr(e.response, 'text'):
            print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
