import express from 'express';
import duckdb from 'duckdb';

const PORT = process.env.PORT || 8080;
const MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;
const PROXY_MODE = (process.env.PROXY_MODE || 'rw').toLowerCase(); // 'rw' or 'ro'
const MAX_ROWS = Number(process.env.MAX_ROWS || 10000);
const MAX_MS = Number(process.env.MAX_MS || 15000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000); // 1 minute
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120); // requests per window per client

if (!MOTHERDUCK_TOKEN) {
  console.warn('[md-query-proxy] WARNING: MOTHERDUCK_TOKEN is not set. The service will not be able to ATTACH to MotherDuck.');
}

// Create a DuckDB in-memory database with allow_unsigned_extensions enabled
const db = new duckdb.Database(':memory:', { allow_unsigned_extensions: 'true' });

// Initialize DuckDB connection
const conn = db.connect();
let currentAttachedDb = null; // tracks which MotherDuck database is attached as catalog 'md'

function ensureAttached(database) {
  return new Promise((resolve, reject) => {
    // If already attached to this database, skip
    if (currentAttachedDb === database) return resolve();

    // Detach previous if exists, then attach requested DB as 'md'
    conn.run('DETACH IF EXISTS md;', () => {
      const attachSql = `ATTACH 'md:${database}' AS md (READ_ONLY FALSE);`;
      conn.run(attachSql, (err) => {
        if (err) return reject(err);
        currentAttachedDb = database;
        resolve();
      });
    });
  });
}

function rewriteSqlForMd(sql) {
  let s = sql;
  // Prefix our known tables when they appear unqualified
  s = s.replace(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(raw_ocr|entities|entity_corrections)\b/gi, (m, op, tbl) => `${op} md.${tbl}`);
  s = s.replace(/\bFROM\s+(raw_ocr|entities|entity_corrections)\b/gi, (m, tbl) => `FROM md.${tbl}`);
  s = s.replace(/\bJOIN\s+(raw_ocr|entities|entity_corrections)\b/gi, (m, tbl) => `JOIN md.${tbl}`);
  return s;
}

function isDangerous(sql) {
  const lowered = sql.trim().toLowerCase();
  // Disallow DDL and extension/runtime changes always
  if (/(\bdrop\b|\btruncate\b|\balter\b|\battach\b|\bdetach\b|\binstall\b|\bload\b|\bset\b)/.test(lowered)) return true;
  return false;
}

function enforceReadOnly(sql) {
  const lowered = sql.trim().toLowerCase();
  // Allow only SELECT and SHOW/DESCRIBE in read-only mode
  if (/^(select|show|describe)\b/.test(lowered)) return true;
  return false;
}

function withLimit(sql) {
  const lowered = sql.trim().toLowerCase();
  if (!lowered.startsWith('select')) return sql; // only apply to SELECT
  // If there's already a LIMIT, do nothing
  if (/\blimit\b\s+\d+/i.test(lowered)) return sql;
  return `${sql}\nLIMIT ${MAX_ROWS}`;
}

async function init() {
  return new Promise((resolve, reject) => {
    // Install and load the MotherDuck extension
    conn.run("INSTALL motherduck;", (err3) => {
      if (err3) return reject(err3);
      conn.run("LOAD motherduck;", (err4) => {
        if (err4) return reject(err4);
        // Set token if provided
        if (MOTHERDUCK_TOKEN) {
          conn.run(`SET motherduck_token='${MOTHERDUCK_TOKEN}';`, (err5) => {
            if (err5) return reject(err5);
            console.log('[md-query-proxy] MotherDuck extension loaded and token set');
            resolve();
          });
        } else {
          console.log('[md-query-proxy] MotherDuck extension loaded (no token)');
          resolve();
        }
      });
    });
  });
}

const app = express();
app.use(express.json({ limit: '5mb' }));

// Minimal in-memory rate limiter (per client IP)
const bucket = new Map(); // key -> { count, reset }
function clientKey(req) {
  const h = req.headers || {};
  return (
    h['cf-connecting-ip'] ||
    (Array.isArray(h['x-forwarded-for']) ? h['x-forwarded-for'][0] : (h['x-forwarded-for'] || '')).split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}
function rateLimit(req, res, next) {
  const key = `${clientKey(req)}:${req.path}`;
  const now = Date.now();
  const item = bucket.get(key) || { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  if (now > item.reset) {
    item.count = 0;
    item.reset = now + RATE_LIMIT_WINDOW_MS;
  }
  item.count += 1;
  bucket.set(key, item);
  if (item.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Rate limit exceeded', retry_after_ms: item.reset - now });
  } else {
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - item.count)));
    res.setHeader('X-RateLimit-Reset', String(item.reset));
    next();
  }
}

app.get('/health', rateLimit, (req, res) => {
  res.json({ status: 'ok', service: 'md-query-proxy' });
});

// POST /query { database: string, query: string }
app.post('/query', rateLimit, async (req, res) => {
  try {
    const { database, query } = req.body || {};
    if (!database || !query) {
      return res.status(400).json({ error: 'Missing database or query' });
    }
    if (!MOTHERDUCK_TOKEN) {
      return res.status(500).json({ error: 'MOTHERDUCK_TOKEN not configured on proxy' });
    }

    const start = Date.now();
    await ensureAttached(database);
    if (isDangerous(query)) {
      return res.status(400).json({ error: 'Dangerous statement blocked' });
    }
    if (PROXY_MODE === 'ro' && !enforceReadOnly(query)) {
      return res.status(400).json({ error: 'Write operations are disabled' });
    }
    const rewritten = withLimit(rewriteSqlForMd(query));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { conn.interrupt && conn.interrupt(); } catch {}
    }, MAX_MS);
    conn.all(rewritten, (err, rows) => {
      clearTimeout(timer);
      if (timedOut) return res.status(504).json({ error: 'Query timed out', elapsed_ms: Date.now() - start });
      if (err) return res.status(400).json({ error: err.message, elapsed_ms: Date.now() - start });

      // Convert BigInt values (DuckDB returns BIGINT for COUNT, etc.) to strings for JSON compatibility
      let safeRows = rows;
      try {
        safeRows = JSON.parse(
          JSON.stringify(rows, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
        );
      } catch (e) {
        // As a fallback, return the raw rows (may still throw if BigInt present)
        console.warn('[md-query-proxy] BigInt serialization fallback:', e);
      }

      return res.json({ data: safeRows || [], elapsed_ms: Date.now() - start });
    });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
});

// Apply rate limit to schema routes
// GET /schema/tables?database=<db>
app.get('/schema/tables', rateLimit, async (req, res) => {
  try {
    const database = req.query.database;
    if (!database) return res.status(400).json({ error: 'Missing database' });
    await ensureAttached(database);
    conn.all('SHOW TABLES FROM md;', (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      // rows: [{ name: 'table' }]
      const tables = (rows || []).map((r) => r.name).filter(Boolean);
      res.json({ tables });
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// GET /schema/columns?database=<db>&table=<name>
app.get('/schema/columns', rateLimit, async (req, res) => {
  try {
    const { database, table } = req.query || {};
    if (!database || !table) return res.status(400).json({ error: 'Missing database or table' });
    await ensureAttached(database);
    const sql = `DESCRIBE md.${table};`;
    conn.all(sql, (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      // rows: columns with field_name and type
      const cols = (rows || []).map((r) => ({ name: r.column_name || r.field || r.name || r.Column, type: r.column_type || r.type }));
      res.json({ columns: cols });
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[md-query-proxy] listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[md-query-proxy] failed to initialize:', err);
    process.exit(1);
  });
