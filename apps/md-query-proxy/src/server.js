import express from 'express';
import duckdb from 'duckdb';

const PORT = process.env.PORT || 8080;
const MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'md-query-proxy' });
});

// POST /query { database: string, query: string }
app.post('/query', async (req, res) => {
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
    const rewritten = rewriteSqlForMd(query);
    conn.all(rewritten, (err, rows) => {
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
