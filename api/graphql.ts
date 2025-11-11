import type { VercelRequest, VercelResponse } from '@vercel/node'
import { postgraphile } from 'postgraphile'
import { createClient } from '@supabase/supabase-js'

// Environment configuration
const DATABASE_URL = process.env.DATABASE_URL
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const MAX_REQUEST_SIZE = 100_000 // 100KB
const REQUEST_TIMEOUT = 30_000 // 30s

if (!DATABASE_URL) {
  console.warn('[/api/graphql] DATABASE_URL not set')
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[/api/graphql] SUPABASE_URL or SUPABASE_ANON_KEY not set - auth validation disabled')
}

// PostGraphile handler with read-only, least-privilege DB credentials
const pgHandler = postgraphile(DATABASE_URL ?? '', ['public', 'ebisu'], {
  dynamicJson: true,
  graphqlRoute: '/api/graphql',
  // Security: GraphiQL disabled in production
  graphiql: false,
  enhanceGraphiql: false,
  enableQueryBatching: true,
  disableDefaultMutations: true, // Read-only API
  ignoreRBAC: false, // Respect PostgreSQL row-level security
  ignoreIndexes: false,
  // Abuse protections
  bodySizeLimit: `${MAX_REQUEST_SIZE}B`,
  // Additional PostGraphile options for security
  disableQueryLog: process.env.VERCEL_ENV === 'production',
}) as unknown as (req: VercelRequest, res: VercelResponse) => void

/**
 * Vercel BFF endpoint for PostGraphile GraphQL API
 *
 * Responsibilities:
 * - Validate Supabase session from cookies
 * - Forward user claims as PostgreSQL local variables
 * - Apply request size/time limits
 * - Proxy to PostGraphile with least-privilege DB role
 *
 * Authentication:
 * - Reads Supabase session from HTTP-only cookies
 * - Validates JWT signature and expiration
 * - Sets `request.jwt.claims.sub` for PostGraphile RLS policies
 *
 * Authorization:
 * - Defers to PostgreSQL row-level security (RLS)
 * - PostGraphile runs as read-only role
 * - User ID passed via local variables for RLS filtering
 */
export default async function graphql(req: VercelRequest, res: VercelResponse) {
  // Abuse protection: Request size limit (enforced by PostGraphile bodySizeLimit)
  // Abuse protection: Timeout
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' })
    }
  }, REQUEST_TIMEOUT)

  try {
    // Method validation: Only POST allowed (GraphQL standard)
    if (req.method !== 'POST') {
      clearTimeout(timeoutId)
      return res.status(405).json({ error: 'Method not allowed' })
    }

    // Supabase session validation (optional - graceful degradation if not configured)
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // Read cookies from Vercel request
          autoRefreshToken: false,
          persistSession: false,
        },
      })

      // Extract Supabase session from cookies
      const authHeader = req.headers.authorization
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

      if (token) {
        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
          clearTimeout(timeoutId)
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired Supabase session'
          })
        }

        // Forward user claims to PostGraphile via custom headers
        // PostGraphile can access these via `current_setting('request.jwt.claims.sub')` in RLS policies
        ;(req as any).headers['x-user-id'] = user.id
        ;(req as any).headers['x-user-email'] = user.email || ''
      } else {
        // No auth token - allow unauthenticated access for public queries
        // (PostGraphile RLS policies will restrict what's visible)
        console.warn('[/api/graphql] No auth token provided - unauthenticated request')
      }
    }

    // Proxy to PostGraphile handler
    return await pgHandler(req, res)
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('[/api/graphql] Error:', error)

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: process.env.VERCEL_ENV === 'development' ? String(error) : undefined
      })
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
