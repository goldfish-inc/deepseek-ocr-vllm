/**
 * Vessel NER Pipeline - Main Router
 *
 * Routes:
 * - POST /upload - Upload PDF handler
 * - POST /webhook/argilla - Argilla callback handler
 * - Queue consumers for OCR, NER, Argilla sync
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { uploadHandler } from './handlers/upload';
import { argillaWebhook } from './handlers/argilla-webhook';

type Bindings = {
  VESSEL_PDFS: R2Bucket;
  PDF_PROCESSING_QUEUE: Queue;
  ENTITY_EXTRACTION_QUEUE: Queue;
  ARGILLA_SYNC_QUEUE: Queue;
  MOTHERDUCK_TOKEN: string;
  HF_TOKEN: string;
  ARGILLA_API_KEY: string;
  DEEPSEEK_OCR_SPACE_URL: string;
  ARGILLA_API_URL: string;
  MOTHERDUCK_DATABASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for upload portal
app.use('/upload', cors({
  origin: ['https://upload.goldfish.io', 'https://vessel-ner-pipeline.ryan-8fa.workers.dev'],
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Requested-With'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'vessel-ner-pipeline', version: '1.0.0' });
});

// Upload endpoint (for humans via web UI)
app.post('/upload', uploadHandler);

// Argilla webhook (for completed annotations)
app.post('/webhook/argilla', argillaWebhook);

// Debug endpoint - list R2 contents
app.get('/r2/list', async (c) => {
  const prefix = c.req.query('prefix') || '';
  const listed = await c.env.VESSEL_PDFS.list({ prefix, limit: 100 });
  return c.json({
    objects: listed.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
    })),
    truncated: listed.truncated,
  });
});

export default app;
