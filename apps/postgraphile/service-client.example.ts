import { GraphQLClient } from 'graphql-request'

/**
 * Service-to-service GraphQL client for PostGraphile API
 *
 * Architecture:
 * - Calls K8s PostGraphile endpoint `graph.boathou.se` (protected by Cloudflare Access)
 * - Includes CF-Access-Client-Id and CF-Access-Client-Secret headers
 * - Service token credentials stored in K8s secrets
 * - Used by backend components (annotation-sink, csv-worker, etc.)
 *
 * Authentication:
 * - Cloudflare Access service token (non-expiring)
 * - Token UUID: 9d715496-cf2d-4631-be19-93dc1c712f54
 * - Client ID: 7d9a2003d9c5fbd626a5f55e7eab1398.access
 * - Client Secret: stored in Pulumi ESC → K8s env var
 *
 * Security:
 * - NEVER commit service token credentials
 * - Load from environment variables only
 * - Rotate tokens via Cloudflare API + update Pulumi ESC
 *
 * Usage in K8s pod:
 * ```ts
 * import { createServiceGraphileClient } from './service-client'
 *
 * const client = createServiceGraphileClient(
 *   process.env.CF_ACCESS_CLIENT_ID!,
 *   process.env.CF_ACCESS_CLIENT_SECRET!
 * )
 *
 * const data = await client.request(gql`
 *   query VesselsByIMO($imo: String!) {
 *     allVessels(filter: { imo: { equalTo: $imo } }) {
 *       nodes {
 *         entityId
 *         imo
 *         mmsi
 *         vesselName
 *       }
 *     }
 *   }
 * `, { imo: '9086758' })
 * ```
 *
 * Kubernetes Deployment:
 * ```yaml
 * apiVersion: apps/v1
 * kind: Deployment
 * metadata:
 *   name: csv-worker
 * spec:
 *   template:
 *     spec:
 *       containers:
 *       - name: worker
 *         env:
 *         - name: CF_ACCESS_CLIENT_ID
 *           valueFrom:
 *             secretKeyRef:
 *               name: postgraphile-access
 *               key: client-id
 *         - name: CF_ACCESS_CLIENT_SECRET
 *           valueFrom:
 *             secretKeyRef:
 *               name: postgraphile-access
 *               key: client-secret
 * ```
 */

const GRAPHQL_ENDPOINT = process.env.GRAPHQL_ENDPOINT || 'https://graph.boathou.se/graphql'

/**
 * Create GraphQL client with Cloudflare Access authentication
 *
 * @param clientId - CF-Access-Client-Id (non-sensitive UUID)
 * @param clientSecret - CF-Access-Client-Secret (sensitive, rotate regularly)
 * @returns GraphQL client configured for service-to-service calls
 */
export function createServiceGraphileClient(
  clientId: string,
  clientSecret: string
): GraphQLClient {
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Cloudflare Access credentials. Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET env vars.'
    )
  }

  return new GraphQLClient(GRAPHQL_ENDPOINT, {
    headers: {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    },

    // Error handling for Cloudflare Access failures
    responseMiddleware: (response) => {
      if (response instanceof Error) {
        console.error('[ServiceGraphQL]', response)
        return
      }

      // 302: Cloudflare Access redirect (missing or invalid credentials)
      if ('status' in response && response.status === 302) {
        throw new Error(
          'Cloudflare Access authentication failed (HTTP 302). Check CF-Access-* headers.'
        )
      }

      // 403: Valid credentials but service token not in Access Policy
      if ('status' in response && response.status === 403) {
        throw new Error(
          'Cloudflare Access denied (HTTP 403). Service token not authorized. Contact platform team.'
        )
      }
    },
  })
}

// Example: Default client for use within K8s cluster
// Load credentials from env vars injected by K8s secrets
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET

export const serviceGraphileClient =
  CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET
    ? createServiceGraphileClient(CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET)
    : null

if (!serviceGraphileClient) {
  console.warn(
    '[ServiceGraphileClient] Not initialized - CF_ACCESS_CLIENT_ID or CF_ACCESS_CLIENT_SECRET missing'
  )
}
