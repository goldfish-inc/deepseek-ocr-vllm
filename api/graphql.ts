import type { VercelRequest, VercelResponse } from '@vercel/node'
import { postgraphile } from 'postgraphile'

// Expect a pooled, read-only Supabase DSN with sslmode=require
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('DATABASE_URL not set for PostGraphile API')
}

const handler = postgraphile(DATABASE_URL ?? '', 'public', {
  dynamicJson: true,
  graphqlRoute: '/api/graphql',
  // Keep GraphiQL off in production; enable locally with VERCEL_ENV=development if desired
  graphiql: false,
  enhanceGraphiql: false,
  enableQueryBatching: true,
  ignoreRBAC: false,
  ignoreIndexes: false,
}) as unknown as (req: VercelRequest, res: VercelResponse) => void

export default function graphql(req: VercelRequest, res: VercelResponse) {
  return handler(req, res)
}
