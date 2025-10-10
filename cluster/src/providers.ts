import fs from "node:fs";
import path from "node:path";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { clusterConfig } from "./config";

// Guard against running cluster stack in GitHub Actions
// This stack must run on a machine that has kubeconfig access, typically via
// Pulumi Deployments with a self-hosted agent. Do not run from GitHub runners.
if (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && process.env.SELF_HOSTED !== "true") {
    throw new Error(
        "❌ Cluster stack cannot run in GitHub-hosted runners.\n\n" +
        "Use a GitHub self-hosted runner on a host with kubeconfig access,\n" +
        "or run locally for break-glass only. Cloud resources live in the 'cloud/' stack."
    );
}

const rawKubeconfigPath = clusterConfig.kubeconfigPath;
if (!rawKubeconfigPath) {
    throw new pulumi.RunError("Kubeconfig path not provided. Set Pulumi config key 'kubeconfigPath' or export KUBECONFIG in the workflow environment.");
}

export const kubeconfigPath = path.resolve(rawKubeconfigPath);

// Validate kubeconfig is an existing file
if (!fs.existsSync(kubeconfigPath) || !fs.statSync(kubeconfigPath).isFile()) {
    throw new pulumi.RunError(`Kubeconfig not found or not a file at ${kubeconfigPath}. Ensure your workflow sets KUBECONFIG or provides 'kubeconfigPath'.`);
}

const kubeconfig = fs.readFileSync(kubeconfigPath, "utf8");

export const k8sProvider = new k8s.Provider("k3s-provider", {
    kubeconfig,
});

export const cloudflareProvider = new cloudflare.Provider("cloudflare-provider", {
    apiToken: clusterConfig.cloudflare.apiToken,
});
