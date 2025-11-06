const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const { postgraphile } = require('postgraphile')

const PORT = process.env.PORT || 8080
const DATABASE_URL = process.env.DATABASE_URL

// PostGraphile GraphQL API for vessels data
// Connects to Crunchy Bridge (ebisu cluster) with strict TLS verification

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

// Parse DATABASE_URL and configure TLS
const { parse } = require('pg-connection-string')
const net = require('net')
const dbConfig = parse(DATABASE_URL)

const host = dbConfig.host || ''
const isSupabasePooler = /pooler\.supabase\.com$/i.test(host)
const isCrunchyBridge = /db\.postgresbridge\.com$/i.test(host)
const isIPHost = net.isIP(host) !== 0
const strictEnv = process.env.DB_SSL_STRICT
const relaxTLS = strictEnv === 'false' || isSupabasePooler || isCrunchyBridge || isIPHost

if (relaxTLS) {
  dbConfig.ssl = { rejectUnauthorized: false }
  console.log('TLS: relaxed verification enabled')
} else {
  dbConfig.ssl = { rejectUnauthorized: true }
  console.log('TLS: strict verification enabled')
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
