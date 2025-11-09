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
app.post('/query', (req, res) => {
  const { database, query } = req.body || {};
  if (!database || !query) {
    return res.status(400).json({ error: 'Missing database or query' });
  }
  if (!MOTHERDUCK_TOKEN) {
    return res.status(500).json({ error: 'MOTHERDUCK_TOKEN not configured on proxy' });
  }

  // Attach MotherDuck database as md
  // We can ATTACH per request to ensure database selection is respected
  const attachSql = `ATTACH 'md:${database}' AS md (READ_ONLY FALSE);`;
  conn.run('DETACH IF EXISTS md;', (e0) => {
    // Ignore detach error
    conn.run(attachSql, (e1) => {
      if (e1) {
        return res.status(502).json({ error: `Failed to attach MotherDuck db: ${e1.message}` });
      }
      const start = Date.now();
      conn.all(query, (e2, rows) => {
        if (e2) {
          return res.status(400).json({ error: e2.message });
        }
        res.json({ data: rows || [], elapsed_ms: Date.now() - start });
      });
    });
  });
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
