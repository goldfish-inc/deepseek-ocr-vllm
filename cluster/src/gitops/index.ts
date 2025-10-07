import * as k8s from "@pulumi/kubernetes";

import { ClusterConfig } from "../config";
import { FluxBootstrap } from "./fluxBootstrap";
import { ImageAutomation } from "./imageAutomation";

export interface GitOpsOptions {
    enableBootstrap: boolean;
    enableImageAutomation: boolean;
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
}

export interface GitOpsResources {
    flux?: FluxBootstrap;
    imageAutomation?: ImageAutomation;
}

export function configureGitOps(options: GitOpsOptions): GitOpsResources {
    const { enableBootstrap, enableImageAutomation, cluster, k8sProvider } = options;

    let flux: FluxBootstrap | undefined;
    if (enableBootstrap) {
        flux = new FluxBootstrap("gitops", {
            cluster,
            k8sProvider,
        });
    }

    let imageAutomation: ImageAutomation | undefined;
    if (enableImageAutomation && flux) {
        imageAutomation = new ImageAutomation("version-monitor", {
            cluster,
            k8sProvider,
            fluxNamespace: "flux-system",
        }, { dependsOn: [flux] });
    }

    return { flux, imageAutomation };
}
