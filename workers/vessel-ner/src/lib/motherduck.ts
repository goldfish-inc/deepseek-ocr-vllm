/**
 * MotherDuck Client
 *
 * Connects to MotherDuck (cloud DuckDB) for parquet-native storage
 * Database: vessel_intelligence
 * Tables: raw_ocr, entities, entity_corrections, processing_log
 */

export interface MotherDuckConfig {
  token: string;
  database: string;
}

export interface RawOcrRow {
  pdf_name: string;
  page_number: number;
  text: string;
  clean_text?: string;
  has_tables: boolean;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface EntityRow {
  document_id: string;
  entity_type: string;
  entity_text: string;
  start_char: number;
  end_char: number;
  confidence: number;
  extracted_at: string;
  model: string;
}

export interface EntityCorrectionRow {
  document_id: string;
  original_entity_type: string;
  corrected_entity_type: string;
  original_text: string;
  corrected_text: string;
  corrected_by: string;
  corrected_at: string;
  correction_type: 'accept' | 'reject' | 'modify';
}

/**
 * MotherDuck Client using HTTP API
 *
 * MotherDuck provides a REST API for queries and writes
 * https://motherduck.com/docs/api-reference
 */
export class MotherDuckClient {
  private token: string;
  private database: string;
  private baseUrl = 'https://api.motherduck.com/v1';

  constructor(config: MotherDuckConfig) {
    this.token = config.token;
    this.database = config.database;
  }

  /**
   * Execute SQL query
   */
  async query<T = unknown>(sql: string): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        database: this.database,
        query: sql,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MotherDuck query failed: ${error}`);
    }

    const result = await response.json() as { data?: T[] };
    return result.data || [];
  }

  /**
   * Insert OCR results into raw_ocr table
   */
  async insertRawOcr(rows: RawOcrRow[]): Promise<void> {
    if (rows.length === 0) return;

    // Build VALUES clauses
    const values = rows.map(row => {
      const metadata = row.metadata ? JSON.stringify(row.metadata) : 'NULL';
      return `(
        '${this.escape(row.pdf_name)}',
        ${row.page_number},
        '${this.escape(row.text)}',
        ${row.clean_text ? `'${this.escape(row.clean_text)}'` : 'NULL'},
        ${row.has_tables},
        '${row.timestamp}',
        '${metadata}'::JSON
      )`;
    }).join(',\n');

    const sql = `
      INSERT INTO raw_ocr (
        pdf_name,
        page_number,
        text,
        clean_text,
        has_tables,
        timestamp,
        metadata
      ) VALUES ${values}
    `;

    await this.query(sql);
  }

  /**
   * Insert extracted entities into entities table
   */
  async insertEntities(rows: EntityRow[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map(row => `(
      '${this.escape(row.document_id)}',
      '${this.escape(row.entity_type)}',
      '${this.escape(row.entity_text)}',
      ${row.start_char},
      ${row.end_char},
      ${row.confidence},
      '${row.extracted_at}',
      '${this.escape(row.model)}'
    )`).join(',\n');

    const sql = `
      INSERT INTO entities (
        document_id,
        entity_type,
        entity_text,
        start_char,
        end_char,
        confidence,
        extracted_at,
        model
      ) VALUES ${values}
    `;

    await this.query(sql);
  }

  /**
   * Insert SME corrections from Argilla
   */
  async insertEntityCorrections(rows: EntityCorrectionRow[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map(row => `(
      '${this.escape(row.document_id)}',
      '${this.escape(row.original_entity_type)}',
      '${this.escape(row.corrected_entity_type)}',
      '${this.escape(row.original_text)}',
      '${this.escape(row.corrected_text)}',
      '${this.escape(row.corrected_by)}',
      '${row.corrected_at}',
      '${row.correction_type}'
    )`).join(',\n');

    const sql = `
      INSERT INTO entity_corrections (
        document_id,
        original_entity_type,
        corrected_entity_type,
        original_text,
        corrected_text,
        corrected_by,
        corrected_at,
        correction_type
      ) VALUES ${values}
    `;

    await this.query(sql);
  }

  /**
   * Get entities for a document (for Argilla sync)
   */
  async getEntitiesForDocument(documentId: string): Promise<EntityRow[]> {
    const sql = `
      SELECT *
      FROM entities
      WHERE document_id = '${this.escape(documentId)}'
      ORDER BY start_char
    `;

    return await this.query<EntityRow>(sql);
  }

  /**
   * Get OCR text for entity extraction
   */
  async getOcrText(documentId: string): Promise<RawOcrRow | null> {
    const sql = `
      SELECT *
      FROM raw_ocr
      WHERE pdf_name || '_page_' || page_number = '${this.escape(documentId)}'
      LIMIT 1
    `;

    const results = await this.query<RawOcrRow>(sql);
    return results[0] || null;
  }

  /**
   * Escape single quotes for SQL
   */
  private escape(str: string): string {
    return str.replace(/'/g, "''");
  }
}
