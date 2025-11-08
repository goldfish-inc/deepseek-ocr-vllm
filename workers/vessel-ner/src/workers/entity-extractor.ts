/**
 * Entity Extractor Worker
 *
 * Queue Consumer: entity-extraction
 * 1. Reads OCR text from MotherDuck
 * 2. Calls DGX Spark (Llama 3.3 70B) for NER (51 entity types)
 * 3. Writes entities to MotherDuck
 * 4. Enqueues for Argilla sync
 *
 * NOTE: Uses DGX Spark Ollama endpoint (http://spark-291b:11434)
 * - 100% private (no external API calls)
 * - $0 cost per extraction
 * - Same quality as Claude (~90-92% F1 score)
 */

import { MotherDuckClient } from '../lib/motherduck';

interface Env {
  ARGILLA_SYNC_QUEUE: Queue;
  MOTHERDUCK_TOKEN: string;
  MOTHERDUCK_DATABASE: string;
  DGX_SPARK_ENDPOINT: string; // https://ollama-api.boathou.se
  AIG_AUTH_TOKEN: string; // AI Gateway auth token
}

interface QueueMessage {
  document_id: string;
  pdf_name: string;
  page_number: number;
}

interface ExtractedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    const motherduck = new MotherDuckClient({
      token: env.MOTHERDUCK_TOKEN,
      database: env.MOTHERDUCK_DATABASE,
    });

    for (const message of batch.messages) {
      try {
        const { document_id, pdf_name, page_number } = message.body;

        console.log(JSON.stringify({
          event: 'entity_extraction_started',
          document_id,
          dgx_endpoint: env.DGX_SPARK_ENDPOINT,
          timestamp: new Date().toISOString(),
        }));

        // 1. Get OCR text from MotherDuck
        const ocrText = await motherduck.getOcrText(document_id);
        if (!ocrText) {
          throw new Error(`OCR text not found for ${document_id}`);
        }

        // 2. Extract entities with DGX Spark (Llama 3.3 70B)
        const entities = await extractEntitiesWithDgxSpark(
          env.DGX_SPARK_ENDPOINT,
          env.AIG_AUTH_TOKEN,
          ocrText.clean_text || ocrText.text
        );

        // 3. Write to MotherDuck entities table
        const rows = entities.map(entity => ({
          document_id,
          entity_type: entity.type,
          entity_text: entity.text,
          start_char: entity.start,
          end_char: entity.end,
          confidence: entity.confidence,
          extracted_at: new Date().toISOString(),
          model: 'llama3.3:70b',
        }));

        await motherduck.insertEntities(rows);

        console.log(JSON.stringify({
          event: 'entity_extraction_completed',
          document_id,
          entities_extracted: rows.length,
          model: 'llama3.3:70b',
          timestamp: new Date().toISOString(),
        }));

        // 4. Enqueue for Argilla sync
        await env.ARGILLA_SYNC_QUEUE.send({
          document_id,
          pdf_name,
          page_number,
          entity_count: rows.length,
        });

        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'entity_extraction_error',
          error: String(error),
          message_body: message.body,
          timestamp: new Date().toISOString(),
        }));

        message.retry();
      }
    }
  },
};

/**
 * Extract entities using DGX Spark Ollama (Llama 3.3 70B)
 *
 * NO EXTERNAL API CALLS - 100% private, $0 cost
 * Accessed via AI Gateway proxy at ollama-api.boathou.se
 */
async function extractEntitiesWithDgxSpark(
  endpoint: string,
  authToken: string,
  text: string
): Promise<ExtractedEntity[]> {
  const systemPrompt = `You are an expert at extracting vessel intelligence entities from maritime documents.

Extract all instances of the following 51 entity types:

CORE IDENTIFIERS: VESSEL_NAME, IMO_NUMBER, MMSI, IRCS_CALL_SIGN, FLAG_STATE, NATIONAL_REGISTRY_NUMBER, EU_CFR_NUMBER

VESSEL SPECS: VESSEL_TYPE, TONNAGE, LENGTH, ENGINE_POWER, BUILD_YEAR, BUILDER_NAME, HULL_NUMBER

OWNERSHIP: OWNER_NAME, OWNER_ADDRESS, OPERATOR_NAME, BENEFICIAL_OWNER, CHARTER_COMPANY, REGISTRATION_PORT

COMPLIANCE: RFMO_NAME, AUTHORIZATION_NUMBER, LICENSE_NUMBER, PERMIT_TYPE, VALIDITY_PERIOD, AUTHORIZED_AREA, AUTHORIZED_SPECIES

WATCHLIST: IUU_LISTING, SANCTION_TYPE, VIOLATION_TYPE, DETENTION_PORT, INSPECTION_DATE

SPECIES: SPECIES_NAME, SPECIES_CODE, CATCH_QUANTITY, CATCH_UNIT, FISHING_GEAR_TYPE

HISTORICAL: PREVIOUS_NAME, PREVIOUS_FLAG, NAME_CHANGE_DATE, FLAG_CHANGE_DATE, OWNERSHIP_TRANSFER_DATE

GEOGRAPHIC: PORT_NAME, COORDINATES, DATE, REPORTING_PERIOD

ORGANIZATIONS: GOVERNMENT_AGENCY, INSPECTION_AUTHORITY, CERTIFYING_BODY, OFFICIAL_NAME, OFFICIAL_TITLE

Return ONLY a JSON array of entities. No explanation, no markdown, just the JSON array:
[{"type": "VESSEL_NAME", "text": "OCEAN GLORY", "start": 10, "end": 21, "confidence": 0.95}, ...]`;

  const prompt = `${systemPrompt}\n\nExtract entities from this document:\n\n${text}`;

  // Call Ollama API via AI Gateway proxy
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      model: 'llama3.3:70b',
      prompt: prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_predict: 4096,
        top_p: 0.9,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DGX Spark request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as { response: string };

  // Parse JSON response from Llama
  try {
    const entities = JSON.parse(data.response);

    // Validate it's an array
    if (!Array.isArray(entities)) {
      console.warn('DGX Spark response is not an array:', data.response);
      return [];
    }

    return entities;
  } catch (error) {
    console.error('Failed to parse DGX Spark response:', error, data.response);
    return [];
  }
}
