#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run
/**
 * Create Pulumi Deployments agent pool and store token in ESC
 *
 * Usage:
 *   1. Ensure PULUMI_ACCESS_TOKEN is set (via op or env)
 *   2. Run: deno run --allow-all scripts/create-agent-pool.ts
 */

import * as pulumi from "npm:@pulumi/pulumi";
import * as pulumiservice from "npm:@pulumi/pulumiservice";

const config = new pulumi.Config();
const orgName = config.get("pulumiOrgName") || "ryan-taylor";
const poolName = config.get("agentPoolName") || "oceanid-cluster";

console.log(`🔧 Creating Pulumi Deployments agent pool: ${poolName}`);

// Create agent pool
const agentPool = new pulumiservice.AgentPool("oceanid-agent-pool", {
    name: poolName,
    organizationName: orgName,
    description: "Self-hosted agent for oceanid-cluster stack with kubeconfig access",
});

// Export token value (will be stored in ESC)
export const agentPoolId = agentPool.agentPoolId;
export const agentToken = agentPool.tokenValue;

// Print instructions
agentToken.apply((token) => {
    console.log(`
✅ Agent pool created successfully!

Agent Pool ID: ${poolName}
Organization: ${orgName}

Next steps:
  1. Store token in ESC:
     esc env set default/oceanid-cluster "pulumi.agentToken" "${token}"

  2. Store token in 1Password:
     op item create --category="API Credential" \\
       --title="Pulumi Agent Token - oceanid-cluster" \\
       --vault="Infrastructure" \\
       credential="${token}"

  3. Deploy agent:
     ./scripts/setup-agent.sh
`);
});
