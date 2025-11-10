/**
 * OCR Processor Worker
 *
 * Queue Consumer: pdf-processing
 * 1. Fetches PDF from R2
 * 2. Calls DeepSeek OCR (HuggingFace Space)
 * 3. Writes results to MotherDuck raw_ocr table
 * 4. Enqueues for entity extraction
 */

import { DeepSeekOcrClient } from '../lib/deepseek-ocr';
import { MdRawOcrParquetWriter, RawDocument, RawPage } from '../lib/parquet-writer';

interface Env {
  VESSEL_PDFS: R2Bucket;
  ENTITY_EXTRACTION_QUEUE: Queue;
  HF_TOKEN: string;
  DEEPSEEK_OCR_SPACE_URL: string;
  USE_DIRECT_UPLOAD?: string; // Feature flag: "true" to use direct HTTP upload

  // S3/R2 credentials for Parquet output
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_PARQUET_BUCKET: string;

  // Provenance tracking
  HF_SPACE_COMMIT?: string;
  OCR_MODEL_VERSION?: string;
  OCR_IMAGE_DIGEST?: string;
}

interface QueueMessage {
  pdf_key: string;
  pdf_name: string;
  uploaded_at: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Test endpoint to debug OCR processing
    if (new URL(request.url).pathname === '/test') {
      try {
        const deepseekOcr = new DeepSeekOcrClient({
          hfToken: env.HF_TOKEN,
          spaceUrl: env.DEEPSEEK_OCR_SPACE_URL,
          useDirectUpload: env.USE_DIRECT_UPLOAD === 'true',
        });

        // Create a small test PDF (just a few bytes)
        const testPdf = new Uint8Array([37, 80, 68, 70]); // "%PDF" header

        return new Response(JSON.stringify({
          status: 'ok',
          config: {
            has_hf_token: !!env.HF_TOKEN,
            token_prefix: env.HF_TOKEN?.substring(0, 8),
            space_url: env.DEEPSEEK_OCR_SPACE_URL,
            has_motherduck: !!env.MOTHERDUCK_TOKEN,
            use_direct_upload: env.USE_DIRECT_UPLOAD === 'true',
          },
          message: 'Test endpoint working. Try POST with a small PDF to test OCR.',
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('OCR Processor Worker - Queue Consumer Only', { status: 404 });
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    // Write marker to R2 to prove queue handler was triggered
    const markerKey = `queue-triggers/${Date.now()}_batch-${batch.messages.length}.json`;
    await env.VESSEL_PDFS.put(markerKey, JSON.stringify({
      event: 'queue_handler_triggered',
      batch_size: batch.messages.length,
      timestamp: new Date().toISOString(),
      messages: batch.messages.map(m => ({ pdf_key: m.body.pdf_key, pdf_name: m.body.pdf_name })),
    }, null, 2));

    console.log(JSON.stringify({
      event: 'queue_handler_triggered',
      batch_size: batch.messages.length,
      timestamp: new Date().toISOString(),
      marker_key: markerKey,
      env_check: {
        has_hf_token: !!env.HF_TOKEN,
        has_r2_creds: !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY,
        space_url: env.DEEPSEEK_OCR_SPACE_URL,
        r2_endpoint: env.R2_ENDPOINT,
        parquet_bucket: env.R2_PARQUET_BUCKET,
        use_direct_upload: env.USE_DIRECT_UPLOAD === 'true',
      },
    }));

    const parquetWriter = new MdRawOcrParquetWriter({
      s3Endpoint: env.R2_ENDPOINT,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_PARQUET_BUCKET,
    });

    const deepseekOcr = new DeepSeekOcrClient({
      hfToken: env.HF_TOKEN,
      spaceUrl: env.DEEPSEEK_OCR_SPACE_URL,
      useDirectUpload: env.USE_DIRECT_UPLOAD === 'true',
    });

    for (const message of batch.messages) {
      try {
        const { pdf_key, pdf_name } = message.body;

        console.log(JSON.stringify({
          event: 'ocr_processing_started',
          pdf_key,
          pdf_name,
          timestamp: new Date().toISOString(),
        }));

        // 1. Generate R2 public URL for the PDF
        // R2 bucket URL format: https://pub-{bucket-hash}.r2.dev/{key}
        const r2PublicUrl = `https://pub-da3225d6239c43eab499f9ec0095e66c.r2.dev/${pdf_key}`;
        console.log(JSON.stringify({
          event: 'r2_public_url_generated',
          pdf_key,
          r2_url: r2PublicUrl,
        }));

        // Verify PDF exists in R2
        const pdfObject = await env.VESSEL_PDFS.get(pdf_key);
        if (!pdfObject) {
          throw new Error(`PDF not found in R2: ${pdf_key}`);
        }

        console.log(JSON.stringify({
          event: 'pdf_exists_in_r2',
          pdf_key,
          size_bytes: pdfObject.size,
        }));

        // Compute doc_sha256 from PDF bytes
        const pdfBytes = await pdfObject.arrayBuffer();
        const doc_sha256 = await MdRawOcrParquetWriter.sha256Binary(pdfBytes);

        // Generate run_id (monotonic timestamp)
        const run_id = BigInt(Date.now());
        const doc_id = pdf_name.replace('.pdf', ''); // Use filename as doc_id for now

        // 2. Process with DeepSeek OCR using URL
        const filenameWithoutExt = pdf_name.replace('.pdf', '');
        console.log(JSON.stringify({
          event: 'calling_deepseek_ocr',
          filename: filenameWithoutExt,
          url: r2PublicUrl,
          doc_id,
          run_id: run_id.toString(),
        }));
        const ocrResults = await deepseekOcr.processPdfFromUrl(r2PublicUrl, filenameWithoutExt);
        console.log(JSON.stringify({
          event: 'deepseek_ocr_completed',
          results_count: ocrResults.length,
        }));

        // 3. Write raw_documents Parquet
        const document: RawDocument = {
          doc_id,
          run_id,
          ingest_ts: new Date(),
          filename: pdf_name,
          r2_key: pdf_key,
          content_type: pdfObject.httpMetadata?.contentType || 'application/pdf',
          size_bytes: BigInt(pdfObject.size),
          doc_sha256,
          uploader: 'cloudflare-worker', // TODO: Track actual user
          source_meta_json: JSON.stringify({ uploaded_at: message.body.uploaded_at }),
          hf_space_commit: env.HF_SPACE_COMMIT || 'unknown',
          ocr_model: env.OCR_MODEL_VERSION || 'deepseek-ocr-3b',
          ocr_image_digest: env.OCR_IMAGE_DIGEST || 'latest',
          ocr_params_json: JSON.stringify({ base_size: 1024 }),
        };

        const documentsKey = await parquetWriter.writeDocuments(document);
        console.log(JSON.stringify({
          event: 'parquet_documents_written',
          key: documentsKey,
        }));

        // 4. Write raw_pages Parquet
        const pages: RawPage[] = await Promise.all(
          ocrResults.map(async (result, index) => {
            const text_sha256 = await MdRawOcrParquetWriter.sha256(result.text);
            return {
              doc_id,
              run_id,
              page_num: index + 1,
              page_width: null, // TODO: Extract from DeepSeek metadata
              page_height: null,
              text: result.text,
              text_sha256,
              page_image_sha256: null,
              ocr_confidence: null, // TODO: Extract if available
              blocks_json: result.metadata?.blocks ? JSON.stringify(result.metadata.blocks) : null,
              lines_json: null,
              tables_json: result.has_tables ? '[]' : null,
              figures_json: null,
              ocr_runtime_ms: null, // TODO: Track per-page timing
              created_at: new Date(),
            };
          })
        );

        const pagesKey = await parquetWriter.writePages(pages);
        console.log(JSON.stringify({
          event: 'parquet_pages_written',
          key: pagesKey,
          pages_count: pages.length,
        }));

        console.log(JSON.stringify({
          event: 'ocr_completed',
          pdf_key,
          doc_id,
          run_id: run_id.toString(),
          pages_processed: pages.length,
          documents_parquet: documentsKey,
          pages_parquet: pagesKey,
          timestamp: new Date().toISOString(),
        }));

        // 5. Enqueue for entity extraction (one message per page)
        for (let i = 0; i < pages.length; i++) {
          await env.ENTITY_EXTRACTION_QUEUE.send({
            document_id: `${doc_id}:${i + 1}`,
            doc_id,
            page_number: i + 1,
            parquet_key: pagesKey,
          });
        }

        // Acknowledge message
        message.ack();
      } catch (error) {
        const errorDetails = {
          event: 'ocr_processing_error',
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined,
          error_name: error instanceof Error ? error.name : undefined,
          error_serialized: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          message_body: message.body,
          timestamp: new Date().toISOString(),
        };
        console.error(JSON.stringify(errorDetails));

        // Write error to R2 for debugging
        try {
          const errorKey = `errors/${Date.now()}_${message.body.pdf_name}.json`;
          await env.VESSEL_PDFS.put(errorKey, JSON.stringify(errorDetails, null, 2));
          console.log(JSON.stringify({ event: 'error_logged_to_r2', error_key: errorKey }));
        } catch (logError) {
          console.error('Failed to write error to R2:', logError);
        }

        // Retry message (will be retried automatically by Cloudflare Queues)
        message.retry();
      }
    }
  },
};
