import fs from "node:fs";
import path from "node:path";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { clusterConfig } from "./config";

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
