import * as pulumi from "@pulumi/pulumi";
import { CrunchyBridgeCluster } from "./components/crunchyBridgeCluster";

// =============================================================================
// OCEANID CLOUD INFRASTRUCTURE
// =============================================================================
// This project manages cloud resources only (Cloudflare, CrunchyBridge, ESC)
// NO kubeconfig required - safe to run in GitHub Actions
//
// Cluster resources (Flux, PKO, etc.) are in ../cluster-bootstrap/
// Application resources are managed by Flux GitOps in ../clusters/
// =============================================================================

const cfg = new pulumi.Config();

// =============================================================================
// CRUNCHYBRIDGE POSTGRESQL 17 DATABASE
// =============================================================================

const enableCrunchyBridgeProvisioning = cfg.getBoolean("enableCrunchyBridgeProvisioning") ?? false;
let crunchyCluster: CrunchyBridgeCluster | undefined;

if (enableCrunchyBridgeProvisioning) {
    crunchyCluster = new CrunchyBridgeCluster("ebisu", {
        apiKey: cfg.requireSecret("crunchybridge_api_key"),
        teamId: cfg.requireSecret("crunchybridge_team_id"),
        name: "ebisu",
        provider: "aws",
        region: "us-east-2",
        planId: "standard-4", // 4GB RAM, 1 vCPU, 50GB storage
        majorVersion: 17,
        storage: 50,
        isHa: false,
    });
}

// Export connection details (conditional on provisioning being enabled)
export const clusterId = crunchyCluster?.outputs.clusterId;
export const clusterHost = crunchyCluster?.outputs.host;
export const clusterStatus = crunchyCluster?.outputs.status;
export const connectionUrl = crunchyCluster?.outputs.connectionUrl;

// =============================================================================
// CLOUDFLARE DNS & ACCESS
// =============================================================================
// TODO: Add Cloudflare DNS records and Access policies
// These will be imported from the existing cluster project in Phase 2

// =============================================================================
// PULUMI ESC
// =============================================================================
// ESC environment remains default/oceanid-cluster (shared with bootstrap project)
