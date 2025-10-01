import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface LabelStudioMlSetupArgs {
    k8sProvider: k8s.Provider;
    namespace: string;
    labelStudioUrl: pulumi.Input<string>;       // e.g., http://label-studio.apps.svc.cluster.local:8080
    mlBackendUrl: pulumi.Input<string>;         // e.g., http://ls-triton-adapter.apps.svc.cluster.local:9090
    apiToken: pulumi.Input<string>;             // Label Studio API token (PAT)
}

/**
 * LabelStudioMlSetup
 *
 * Creates a Kubernetes CronJob that automatically connects the ML backend to all Label Studio projects.
 * This ensures new projects get the ML backend without manual configuration.
 *
 * Architecture:
 * - Runs on a schedule (default: hourly) to discover new projects
 * - Uses Label Studio admin credentials to authenticate
 * - Checks all projects and adds ML backend if missing
 * - Idempotent: safe to run multiple times
 *
 * Authentication:
 * - Uses Label Studio API token (Personal Access Token from 1Password)
 * - Token stored as Kubernetes secret and mounted as environment variable
 */
export class LabelStudioMlSetup extends pulumi.ComponentResource {
    public readonly cronJobName: pulumi.Output<string>;

    constructor(name: string, args: LabelStudioMlSetupArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:LabelStudioMlSetup", name, {}, opts);

        const {
            k8sProvider,
            namespace,
            labelStudioUrl,
            mlBackendUrl,
            apiToken,
        } = args;

        // Python script that connects ML backend to all projects
        const setupScript = `#!/usr/bin/env python3
"""
Label Studio ML Backend Auto-Setup

Automatically connects ML backend to all Label Studio projects.
Runs as a Kubernetes CronJob to handle new projects.
"""

import os
import sys
import json
import requests
from typing import Optional

LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "http://label-studio.apps.svc.cluster.local:8080")
ML_BACKEND_URL = os.getenv("ML_BACKEND_URL", "http://ls-triton-adapter.apps.svc.cluster.local:9090")
API_TOKEN = os.getenv("LABEL_STUDIO_API_TOKEN")

def get_auth_token() -> Optional[str]:
    """Get authentication token from environment."""
    if not API_TOKEN:
        print("❌ LABEL_STUDIO_API_TOKEN environment variable not set")
        sys.exit(1)

    print(f"✅ Using API token from environment")
    return API_TOKEN

def list_projects(token: Optional[str]) -> list:
    """List all Label Studio projects."""
    headers = {"Authorization": f"Token {token}"} if token else {}

    try:
        response = requests.get(
            f"{LABEL_STUDIO_URL}/api/projects",
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        projects = response.json()
        print(f"📋 Found {len(projects)} projects")
        return projects
    except requests.exceptions.RequestException as e:
        print(f"❌ Failed to list projects: {e}")
        return []

def get_ml_backends(project_id: int, token: Optional[str]) -> list:
    """Get ML backends connected to a project."""
    headers = {"Authorization": f"Token {token}"} if token else {}

    try:
        response = requests.get(
            f"{LABEL_STUDIO_URL}/api/ml",
            headers=headers,
            params={"project": project_id},
            timeout=10
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"❌ Failed to get ML backends for project {project_id}: {e}")
        return []

def add_ml_backend(project_id: int, project_title: str, token: Optional[str]) -> bool:
    """Add ML backend to a project if not already connected."""
    headers = {
        "Authorization": f"Token {token}",
        "Content-Type": "application/json"
    } if token else {"Content-Type": "application/json"}

    # Check if backend already exists
    existing = get_ml_backends(project_id, token)
    for backend in existing:
        if backend.get("url") == ML_BACKEND_URL:
            print(f"  ✓ ML backend already connected to '{project_title}'")
            return True

    # Add ML backend
    payload = {
        "url": ML_BACKEND_URL,
        "project": project_id,
        "title": "Triton Inference Backend",
        "description": "DistilBERT NER + Docling Granite (auto-configured)",
        "is_interactive": True
    }

    try:
        response = requests.post(
            f"{LABEL_STUDIO_URL}/api/ml",
            headers=headers,
            json=payload,
            timeout=10
        )
        response.raise_for_status()
        print(f"  ✅ Connected ML backend to '{project_title}'")
        return True
    except requests.exceptions.RequestException as e:
        print(f"  ❌ Failed to add ML backend to '{project_title}': {e}")
        if hasattr(e, 'response') and e.response:
            print(f"     Response: {e.response.text}")
        return False

def main():
    """Main setup logic."""
    print("="*60)
    print("Label Studio ML Backend Auto-Setup")
    print("="*60)
    print(f"Label Studio: {LABEL_STUDIO_URL}")
    print(f"ML Backend: {ML_BACKEND_URL}")
    print()

    # Authenticate
    token = get_auth_token()

    # Get all projects
    projects = list_projects(token)
    if not projects:
        print("ℹ️  No projects found or access denied")
        return

    # Connect ML backend to each project
    success_count = 0
    for project in projects:
        project_id = project.get("id")
        project_title = project.get("title", f"Project {project_id}")

        print(f"\\n🔧 Processing: {project_title} (ID: {project_id})")
        if add_ml_backend(project_id, project_title, token):
            success_count += 1

    print()
    print("="*60)
    print(f"✅ Setup Complete: {success_count}/{len(projects)} projects configured")
    print("="*60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
`;

        // ConfigMap with the setup script
        const configMap = new k8s.core.v1.ConfigMap(
            `${name}-script`,
            {
                metadata: {
                    name: "ls-ml-setup-script",
                    namespace,
                },
                data: {
                    "setup.py": setupScript,
                },
            },
            { provider: k8sProvider, parent: this }
        );

        // CronJob that runs the setup script hourly
        const cronJob = new k8s.batch.v1.CronJob(
            `${name}-cronjob`,
            {
                metadata: {
                    name: "ls-ml-setup",
                    namespace,
                    labels: {
                        "app": "ls-ml-setup",
                        "oceanid.cluster/managed-by": "pulumi",
                    },
                },
                spec: {
                    schedule: "0 * * * *", // Every hour
                    successfulJobsHistoryLimit: 3,
                    failedJobsHistoryLimit: 3,
                    jobTemplate: {
                        spec: {
                            backoffLimit: 2,
                            template: {
                                metadata: {
                                    labels: { "app": "ls-ml-setup" },
                                },
                                spec: {
                                    restartPolicy: "OnFailure",
                                    containers: [
                                        {
                                            name: "setup",
                                            image: "python:3.11-slim",
                                            command: ["/bin/sh", "-c"],
                                            args: [
                                                "pip install --quiet requests && python /scripts/setup.py"
                                            ],
                                            env: [
                                                {
                                                    name: "LABEL_STUDIO_URL",
                                                    value: labelStudioUrl as any,
                                                },
                                                {
                                                    name: "ML_BACKEND_URL",
                                                    value: mlBackendUrl as any,
                                                },
                                                {
                                                    name: "LABEL_STUDIO_API_TOKEN",
                                                    value: apiToken as any,
                                                },
                                            ] as any,
                                            volumeMounts: [
                                                {
                                                    name: "script",
                                                    mountPath: "/scripts",
                                                },
                                            ],
                                            resources: {
                                                requests: { cpu: "50m", memory: "64Mi" },
                                                limits: { cpu: "200m", memory: "128Mi" },
                                            },
                                        },
                                    ],
                                    volumes: [
                                        {
                                            name: "script",
                                            configMap: { name: "ls-ml-setup-script" },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
            { provider: k8sProvider, parent: this, dependsOn: [configMap] }
        );

        this.cronJobName = cronJob.metadata.name;
        this.registerOutputs({ cronJobName: this.cronJobName });
    }
}
