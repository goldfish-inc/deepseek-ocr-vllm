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
import { MotherDuckClient } from '../lib/motherduck';

interface Env {
  VESSEL_PDFS: R2Bucket;
  ENTITY_EXTRACTION_QUEUE: Queue;
  MOTHERDUCK_TOKEN: string;
  HF_TOKEN: string;
  DEEPSEEK_OCR_SPACE_URL: string;
  MOTHERDUCK_DATABASE: string;
}

interface QueueMessage {
  pdf_key: string;
  pdf_name: string;
  uploaded_at: string;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    console.log(JSON.stringify({
      event: 'queue_handler_triggered',
      batch_size: batch.messages.length,
      timestamp: new Date().toISOString(),
    }));

    const motherduck = new MotherDuckClient({
      token: env.MOTHERDUCK_TOKEN,
      database: env.MOTHERDUCK_DATABASE,
    });

    const deepseekOcr = new DeepSeekOcrClient({
      hfToken: env.HF_TOKEN,
      spaceUrl: env.DEEPSEEK_OCR_SPACE_URL,
    });

    for (const message of batch.messages) {
      try {
        const { pdf_key, pdf_name } = message.body;

        console.log(JSON.stringify({
          event: 'ocr_processing_started',
          pdf_key,
          timestamp: new Date().toISOString(),
        }));

        // 1. Fetch PDF from R2
        const pdfObject = await env.VESSEL_PDFS.get(pdf_key);
        if (!pdfObject) {
          throw new Error(`PDF not found in R2: ${pdf_key}`);
        }

        const pdfBuffer = await pdfObject.arrayBuffer();

        // 2. Process with DeepSeek OCR
        // Pass filename without extension for tracking
        const filenameWithoutExt = pdf_name.replace('.pdf', '');
        const ocrResults = await deepseekOcr.processPdf(pdfBuffer, filenameWithoutExt);

        // 3. Write to MotherDuck raw_ocr table
        const rows = ocrResults.map((result, index) => ({
          pdf_name,
          page_number: index + 1,
          text: result.text,
          clean_text: result.clean_text,
          has_tables: result.has_tables,
          timestamp: new Date().toISOString(),
          metadata: {
            pdf_key,
            ...result.metadata,
          },
        }));

        await motherduck.insertRawOcr(rows);

        console.log(JSON.stringify({
          event: 'ocr_completed',
          pdf_key,
          pages_processed: rows.length,
          timestamp: new Date().toISOString(),
        }));

        // 4. Enqueue for entity extraction (one message per page)
        for (let i = 0; i < rows.length; i++) {
          await env.ENTITY_EXTRACTION_QUEUE.send({
            document_id: `${pdf_name}_page_${i + 1}`,
            pdf_name,
            page_number: i + 1,
          });
        }

        // Acknowledge message
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'ocr_processing_error',
          error: String(error),
          message_body: message.body,
          timestamp: new Date().toISOString(),
        }));

        // Retry message (will be retried automatically by Cloudflare Queues)
        message.retry();
      }
    }
  },
};
