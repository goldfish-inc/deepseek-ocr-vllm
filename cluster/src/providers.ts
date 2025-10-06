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

export const kubeconfigPath = path.resolve(clusterConfig.kubeconfigPath);

if (!fs.existsSync(kubeconfigPath)) {
    throw new pulumi.RunError(`Kubeconfig not found at ${kubeconfigPath}. Set config key 'kubeconfigPath' or export KUBECONFIG.`);
}

const kubeconfig = fs.readFileSync(kubeconfigPath, "utf8");

export const k8sProvider = new k8s.Provider("k3s-provider", {
    kubeconfig,
});

export const cloudflareProvider = new cloudflare.Provider("cloudflare-provider", {
    apiToken: clusterConfig.cloudflare.apiToken,
});
