/**
 * Argilla Sync Worker
 *
 * Queue Consumer: argilla-sync
 * 1. Fetches entities from MotherDuck
 * 2. Formats for Argilla annotation UI
 * 3. Pushes to Argilla API (K8s cluster)
 */

import { MotherDuckClient } from '../lib/motherduck';
import { ArgillaClient, ArgillaRecord } from '../lib/argilla';

interface Env {
  MOTHERDUCK_TOKEN: string;
  ARGILLA_API_KEY: string;
  ARGILLA_API_URL: string;
  MOTHERDUCK_DATABASE: string;
}

interface QueueMessage {
  document_id: string;
  pdf_name: string;
  page_number: number;
  entity_count: number;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    const motherduck = new MotherDuckClient({
      token: env.MOTHERDUCK_TOKEN,
      database: env.MOTHERDUCK_DATABASE,
    });

    const argilla = new ArgillaClient({
      apiUrl: env.ARGILLA_API_URL,
      apiKey: env.ARGILLA_API_KEY,
    });

    // Ensure dataset exists (idempotent)
    await argilla.ensureDataset();

    for (const message of batch.messages) {
      try {
        const { document_id, pdf_name, page_number } = message.body;

        console.log(JSON.stringify({
          event: 'argilla_sync_started',
          document_id,
          timestamp: new Date().toISOString(),
        }));

        // 1. Get OCR text and entities from MotherDuck
        const ocrText = await motherduck.getOcrText(document_id);
        if (!ocrText) {
          throw new Error(`OCR text not found for ${document_id}`);
        }

        const entities = await motherduck.getEntitiesForDocument(document_id);

        // 2. Format as Argilla record with suggestions
        const record: ArgillaRecord = {
          fields: {
            text: ocrText.clean_text || ocrText.text,
            document_id,
          },
          metadata: {
            pdf_name,
            page_number,
            has_tables: ocrText.has_tables,
            entity_count: entities.length,
          },
          suggestions: [
            {
              question_name: 'entities',
              value: entities.map(e => ({
                start: e.start_char,
                end: e.end_char,
                label: e.entity_type,
              })),
              score: entities.length > 0
                ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
                : 0,
              agent: 'claude-haiku-4-5',
            },
          ],
        };

        // 3. Push to Argilla
        await argilla.pushRecords([record]);

        console.log(JSON.stringify({
          event: 'argilla_sync_completed',
          document_id,
          entities_pushed: entities.length,
          timestamp: new Date().toISOString(),
        }));

        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'argilla_sync_error',
          error: String(error),
          message_body: message.body,
          timestamp: new Date().toISOString(),
        }));

        message.retry();
      }
    }
  },
};
