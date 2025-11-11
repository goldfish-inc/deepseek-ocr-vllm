import { GraphQLClient } from 'graphql-request'

/**
 * Browser-side GraphQL client for PostGraphile API
 *
 * Architecture:
 * - Calls Vercel BFF endpoint `/api/graphql` (same-origin)
 * - BFF validates Supabase session and forwards user claims
 * - No credentials exposed to browser
 * - No CORS issues (same-origin request)
 *
 * Authentication:
 * - Supabase auth token sent via Authorization header
 * - BFF validates token and extracts user ID
 * - User ID forwarded to PostGraphile for RLS policies
 *
 * Usage:
 * ```ts
 * import { graphileClient } from '@/lib/graphile-client'
 *
 * const data = await graphileClient.request(gql`
 *   query VesselSearch($q: String!) {
 *     searchVessels(q: $q, limitN: 10) {
 *       entityId
 *       imo
 *       mmsi
 *       vesselName
 *     }
 *   }
 * `, { q: 'TAISEI' })
 * ```
 */

// GraphQL client configured for Vercel BFF
export const graphileClient = new GraphQLClient('/api/graphql', {
  // Credentials: include cookies for Supabase session
  credentials: 'include',

  // Headers: automatically include Supabase auth token
  // (Set by your auth provider - e.g., Supabase Auth helpers)
  headers: () => {
    // If using Supabase Auth, the session token should be available
    // via your auth context/store. Example:
    // const session = getSupabaseSession()
    // return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}

    // For now, return empty headers - implement based on your auth setup
    return {}
  },

  // Error handling
  responseMiddleware: (response) => {
    if (response instanceof Error) {
      console.error('[GraphQL]', response)
    }

    // Handle 401 Unauthorized - redirect to login
    if ('status' in response && response.status === 401) {
      console.warn('[GraphQL] Unauthorized - session expired')
      // Implement your auth redirect logic here
      // e.g., window.location.href = '/login'
    }
  },
})

/**
 * Helper function to set auth token dynamically
 * Call this after user login to update the GraphQL client headers
 *
 * Example:
 * ```ts
 * // After Supabase login
 * const { data: { session } } = await supabase.auth.getSession()
 * if (session) {
 *   setGraphileAuthToken(session.access_token)
 * }
 * ```
 */
export function setGraphileAuthToken(token: string | null) {
  if (token) {
    graphileClient.setHeader('Authorization', `Bearer ${token}`)
  } else {
    // Clear auth header on logout
    graphileClient.setHeader('Authorization', '')
  }
}
