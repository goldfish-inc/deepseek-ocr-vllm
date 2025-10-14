import fs from "node:fs";
import path from "node:path";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { clusterConfig } from "./config";

// Cluster stack can now run in GitHub-hosted runners.
// Kubeconfig is sourced from KUBECONFIG environment variable, which is decoded from ESC in CI.
// For local development, ensure KUBECONFIG points to a valid kubeconfig file.

const rawKubeconfigPath = clusterConfig.kubeconfigPath;
if (!rawKubeconfigPath) {
    throw new pulumi.RunError("KUBECONFIG must be set to a kubeconfig file path in the workflow environment.");
}

export const kubeconfigPath = path.resolve(rawKubeconfigPath);

// Validate kubeconfig is an existing file
if (!fs.existsSync(kubeconfigPath) || !fs.statSync(kubeconfigPath).isFile()) {
    throw new pulumi.RunError(`Kubeconfig not found or not a file at ${kubeconfigPath}. Ensure your workflow sets KUBECONFIG to a valid file path.`);
}

const kubeconfig = fs.readFileSync(kubeconfigPath, "utf8");

export const k8sProvider = new k8s.Provider("k3s-provider", {
    kubeconfig,
});

export const cloudflareProvider = new cloudflare.Provider("cloudflare-provider", {
    apiToken: clusterConfig.cloudflare.apiToken,
});
