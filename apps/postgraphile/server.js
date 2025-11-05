const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const { postgraphile } = require('postgraphile')

const PORT = process.env.PORT || 8080
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('DATABASE_URL is not set; PostGraphile will fail to start')
}

const app = express()

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // GraphQL is API-only; CSP typically handled at edge
  })
)

// CORS allowlist (comma-separated). If unset, defaults to allowing only same-origin fetches via proxies.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (corsOrigins.length > 0) {
  app.use(
    cors({
      origin: function (origin, cb) {
        if (!origin) return cb(null, true) // SSR/server-side or same-origin
        if (corsOrigins.includes(origin)) return cb(null, true)
        return cb(new Error('Not allowed by CORS'))
      },
      credentials: false,
    })
  )
}

// Health check
app.get('/healthz', (_req, res) => res.status(200).send('ok'))

// Parse DATABASE_URL and add SSL configuration for Supabase
const { parse } = require('pg-connection-string')
const dbConfig = parse(DATABASE_URL)
dbConfig.ssl = {
  rejectUnauthorized: true, // Verify certificate
  ca: undefined, // Use system CA certificates
}

app.use(
  postgraphile(dbConfig, 'public', {
    dynamicJson: true,
    // Production-safe defaults
    graphiql: false,
    enhanceGraphiql: false,
    enableQueryBatching: true,
    disableDefaultMutations: true,
    ignoreRBAC: false,
    ignoreIndexes: false,
  })
)

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`PostGraphile listening on :${PORT}`)
})
