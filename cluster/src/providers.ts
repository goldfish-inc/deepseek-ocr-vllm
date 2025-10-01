import fs from "node:fs";
import path from "node:path";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { clusterConfig } from "./config";

// Guard against running cluster stack in GitHub Actions
// This stack requires kubeconfig access and should run locally or on self-hosted runners
if (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true") {
    throw new Error(
        "❌ CLUSTER STACK CANNOT RUN IN GITHUB ACTIONS\n\n" +
        "This stack manages Kubernetes resources and requires kubeconfig access.\n" +
        "It MUST run locally or on a self-hosted runner with cluster access.\n\n" +
        "For cloud resources (Cloudflare, CrunchyBridge), use the 'oceanid-cloud' stack instead.\n" +
        "See cloud/README.md for details."
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
