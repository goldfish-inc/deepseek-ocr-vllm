import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface LabelStudioMlAutoconnectArgs {
    k8sProvider: k8s.Provider;
    namespace: string;
    labelStudioUrl: pulumi.Input<string>;       // e.g., http://label-studio.apps.svc.cluster.local:8080
    mlBackendUrl: pulumi.Input<string>;         // e.g., http://ls-triton-adapter.apps.svc.cluster.local:9090
    apiToken: pulumi.Input<string>;             // Label Studio API token (PAT)
}

/**
 * LabelStudioMlAutoconnect
 *
 * Real-time ML backend auto-connection using Label Studio webhooks.
 * Connects ML backend to projects immediately when created (no delay).
 *
 * Architecture:
 * 1. FastAPI webhook receiver listens for PROJECT_CREATED events
 * 2. On startup, registers webhook with Label Studio
 * 3. When project created, webhook fires instantly
 * 4. Service connects ML backend to new project
 * 5. Fallback: Also runs hourly sync for any missed projects
 *
 * Benefits over CronJob:
 * - Instant connection (no waiting up to 1 hour)
 * - Better UX for users creating projects
 * - Still has safety fallback via hourly sync
 */
export class LabelStudioMlAutoconnect extends pulumi.ComponentResource {
    public readonly serviceName: pulumi.Output<string>;
    public readonly serviceUrl: pulumi.Output<string>;

    constructor(name: string, args: LabelStudioMlAutoconnectArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:LabelStudioMlAutoconnect", name, {}, opts);

        const {
            k8sProvider,
            namespace,
            labelStudioUrl,
            mlBackendUrl,
            apiToken,
        } = args;

        // FastAPI webhook receiver + registration service
        const appCode = `from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
import os
import logging
from typing import Optional
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Label Studio ML Auto-connect")

# Configuration
LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "http://label-studio-ls-app.apps.svc.cluster.local:8080")
ML_BACKEND_URL = os.getenv("ML_BACKEND_URL", "http://ls-triton-adapter.apps.svc.cluster.local:9090")
API_TOKEN = os.getenv("LABEL_STUDIO_API_TOKEN")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "http://ls-ml-autoconnect.apps.svc.cluster.local:8080/webhook")

headers = {
    "Authorization": f"Token {API_TOKEN}",
    "Content-Type": "application/json"
}

async def connect_ml_backend(project_id: int, project_title: str) -> bool:
    """Connect ML backend to a project."""
    # Check if already connected
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # Get existing backends
            response = await client.get(
                f"{LABEL_STUDIO_URL}/api/ml",
                headers=headers,
                params={"project": project_id}
            )
            response.raise_for_status()
            existing_backends = response.json()

            for backend in existing_backends:
                if backend.get("url") == ML_BACKEND_URL:
                    logger.info(f"ML backend already connected to project {project_id} '{project_title}'")
                    return True

            # Add ML backend
            payload = {
                "url": ML_BACKEND_URL,
                "project": project_id,
                "title": "Triton Inference Backend",
                "description": "DistilBERT NER + Docling Granite (auto-configured via webhook)",
                "is_interactive": True
            }

            response = await client.post(
                f"{LABEL_STUDIO_URL}/api/ml",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            logger.info(f"✅ Connected ML backend to project {project_id} '{project_title}'")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to connect ML backend to project {project_id}: {e}")
            return False

async def sync_all_projects():
    """Fallback: sync all existing projects (runs on startup and hourly)."""
    logger.info("🔄 Syncing ML backend to all existing projects...")
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # List all projects
            response = await client.get(
                f"{LABEL_STUDIO_URL}/api/projects",
                headers=headers
            )
            response.raise_for_status()
            projects = response.json()

            logger.info(f"Found {len(projects)} projects to sync")

            success_count = 0
            for project in projects:
                project_id = project.get("id")
                project_title = project.get("title", f"Project {project_id}")

                if await connect_ml_backend(project_id, project_title):
                    success_count += 1

            logger.info(f"✅ Sync complete: {success_count}/{len(projects)} projects configured")

        except Exception as e:
            logger.error(f"❌ Sync failed: {e}")

async def register_webhook():
    """Register PROJECT_CREATED webhook with Label Studio."""
    logger.info("📝 Registering PROJECT_CREATED webhook...")
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # Check if webhook already exists
            response = await client.get(
                f"{LABEL_STUDIO_URL}/api/webhooks",
                headers=headers
            )
            response.raise_for_status()
            webhooks = response.json()

            for webhook in webhooks:
                if webhook.get("url") == WEBHOOK_URL:
                    logger.info(f"✅ Webhook already registered (ID: {webhook['id']})")
                    return

            # Create webhook
            payload = {
                "url": WEBHOOK_URL,
                "send_payload": True,
                "send_for_all_actions": False,
                "headers": {},
                "is_active": True,
                "actions": ["PROJECT_CREATED"]
            }

            response = await client.post(
                f"{LABEL_STUDIO_URL}/api/webhooks",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            webhook_data = response.json()
            logger.info(f"✅ Webhook registered successfully (ID: {webhook_data['id']})")

        except Exception as e:
            logger.error(f"❌ Failed to register webhook: {e}")

@app.on_event("startup")
async def startup_event():
    """On startup: register webhook and sync existing projects."""
    if not API_TOKEN:
        logger.error("❌ LABEL_STUDIO_API_TOKEN not set")
        return

    logger.info("="*60)
    logger.info("Label Studio ML Auto-connect Starting")
    logger.info("="*60)
    logger.info(f"Label Studio: {LABEL_STUDIO_URL}")
    logger.info(f"ML Backend: {ML_BACKEND_URL}")
    logger.info(f"Webhook URL: {WEBHOOK_URL}")
    logger.info("")

    await register_webhook()
    await sync_all_projects()

    # Start background task for hourly sync
    asyncio.create_task(hourly_sync())

async def hourly_sync():
    """Run sync every hour as fallback."""
    while True:
        await asyncio.sleep(3600)  # 1 hour
        await sync_all_projects()

@app.post("/webhook")
async def webhook_receiver(request: Request):
    """Receive PROJECT_CREATED webhook from Label Studio."""
    try:
        payload = await request.json()
        action = payload.get("action")

        if action != "PROJECT_CREATED":
            logger.debug(f"Ignoring webhook action: {action}")
            return JSONResponse({"status": "ignored", "action": action})

        project = payload.get("project", {})
        project_id = project.get("id")
        project_title = project.get("title", f"Project {project_id}")

        logger.info(f"🆕 PROJECT_CREATED webhook received: {project_title} (ID: {project_id})")

        # Connect ML backend immediately
        success = await connect_ml_backend(project_id, project_title)

        return JSONResponse({
            "status": "success" if success else "error",
            "project_id": project_id,
            "project_title": project_title,
            "ml_backend_connected": success
        })

    except Exception as e:
        logger.error(f"❌ Webhook processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"ok": True}

@app.get("/sync")
async def trigger_sync():
    """Manual sync trigger (for debugging)."""
    await sync_all_projects()
    return {"status": "sync_triggered"}
`;

        // ConfigMap with FastAPI app
        const configMap = new k8s.core.v1.ConfigMap(
            `${name}-code`,
            {
                metadata: {
                    name: "ls-ml-autoconnect-code",
                    namespace,
                },
                data: {
                    "main.py": appCode,
                    "requirements.txt": `fastapi==0.115.0
uvicorn[standard]==0.32.0
httpx==0.28.1`,
                },
            },
            { provider: k8sProvider, parent: this }
        );

        const labels = { app: "ls-ml-autoconnect" };

        // Deployment
        const deployment = new k8s.apps.v1.Deployment(
            `${name}-deploy`,
            {
                metadata: {
                    name: "ls-ml-autoconnect",
                    namespace,
                    labels,
                },
                spec: {
                    replicas: 1,
                    selector: { matchLabels: labels },
                    template: {
                        metadata: { labels },
                        spec: {
                            containers: [
                                {
                                    name: "autoconnect",
                                    image: "python:3.11-slim",
                                    command: ["/bin/sh", "-c"],
                                    args: [
                                        "pip install --quiet -r /app/requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8080"
                                    ],
                                    workingDir: "/app",
                                    ports: [{ containerPort: 8080, name: "http" }],
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
                                        {
                                            name: "WEBHOOK_URL",
                                            value: "http://ls-ml-autoconnect.apps.svc.cluster.local:8080/webhook",
                                        },
                                    ] as any,
                                    volumeMounts: [
                                        {
                                            name: "code",
                                            mountPath: "/app",
                                        },
                                    ],
                                    resources: {
                                        requests: { cpu: "50m", memory: "128Mi" },
                                        limits: { cpu: "200m", memory: "256Mi" },
                                    },
                                    readinessProbe: {
                                        httpGet: { path: "/health", port: "http" as any },
                                        initialDelaySeconds: 10,
                                        periodSeconds: 10,
                                    },
                                    livenessProbe: {
                                        httpGet: { path: "/health", port: "http" as any },
                                        initialDelaySeconds: 30,
                                        periodSeconds: 30,
                                    },
                                },
                            ],
                            volumes: [
                                {
                                    name: "code",
                                    configMap: { name: "ls-ml-autoconnect-code" },
                                },
                            ],
                        },
                    },
                },
            },
            { provider: k8sProvider, parent: this, dependsOn: [configMap] }
        );

        // Service
        const service = new k8s.core.v1.Service(
            `${name}-svc`,
            {
                metadata: {
                    name: "ls-ml-autoconnect",
                    namespace,
                    labels,
                },
                spec: {
                    selector: labels,
                    ports: [{ port: 8080, targetPort: "http" as any, name: "http" }],
                },
            },
            { provider: k8sProvider, parent: this }
        );

        this.serviceName = service.metadata.name;
        this.serviceUrl = pulumi.interpolate`http://${service.metadata.name}.${namespace}.svc.cluster.local:8080`;
        this.registerOutputs({
            serviceName: this.serviceName,
            serviceUrl: this.serviceUrl,
        });
    }
}
