/**
 * Parquet Writer for MotherDuck Raw OCR Schema
 *
 * Writes OCR results to Parquet files in S3/R2 compatible with md_raw_ocr schema
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ParquetWriter, ParquetSchema } from 'parquetjs-lite';

export interface ParquetWriterConfig {
  s3Endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

export interface RawDocument {
  doc_id: string;
  run_id: bigint;
  ingest_ts: Date;
  filename: string;
  r2_key: string;
  content_type: string;
  size_bytes: bigint;
  doc_sha256: string;
  uploader: string;
  source_meta_json: string;  // Stringified JSON
  hf_space_commit: string;
  ocr_model: string;
  ocr_image_digest: string;
  ocr_params_json: string;   // Stringified JSON
}

export interface RawPage {
  doc_id: string;
  run_id: bigint;
  page_num: number;
  page_width: number | null;
  page_height: number | null;
  text: string;
  text_sha256: string;
  page_image_sha256: string | null;
  ocr_confidence: number | null;
  blocks_json: string | null;   // Stringified JSON
  lines_json: string | null;    // Stringified JSON
  tables_json: string | null;   // Stringified JSON
  figures_json: string | null;  // Stringified JSON
  ocr_runtime_ms: bigint | null;
  created_at: Date;
}

/**
 * Parquet Writer for md_raw_ocr schema
 */
export class MdRawOcrParquetWriter {
  private s3Client: S3Client;
  private bucket: string;

  constructor(config: ParquetWriterConfig) {
    this.s3Client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucket = config.bucket;
  }

  /**
   * Write raw_documents Parquet to S3/R2
   * Path: md_raw_ocr/documents/date=YYYY-MM-DD/doc_id={doc_id}/run_id={run_id}/part-000.parquet
   */
  async writeDocuments(document: RawDocument): Promise<string> {
    const date = document.ingest_ts.toISOString().split('T')[0];
    const key = `md_raw_ocr/documents/date=${date}/doc_id=${document.doc_id}/run_id=${document.run_id}/part-000.parquet`;

    // Define Parquet schema
    const schema = new ParquetSchema({
      doc_id: { type: 'UTF8', optional: false },
      run_id: { type: 'INT64', optional: false },
      ingest_ts: { type: 'TIMESTAMP_MILLIS', optional: false },
      filename: { type: 'UTF8', optional: true },
      r2_key: { type: 'UTF8', optional: true },
      content_type: { type: 'UTF8', optional: true },
      size_bytes: { type: 'INT64', optional: true },
      doc_sha256: { type: 'UTF8', optional: false },
      uploader: { type: 'UTF8', optional: true },
      source_meta_json: { type: 'UTF8', optional: true },
      hf_space_commit: { type: 'UTF8', optional: true },
      ocr_model: { type: 'UTF8', optional: true },
      ocr_image_digest: { type: 'UTF8', optional: true },
      ocr_params_json: { type: 'UTF8', optional: true },
    });

    // Write to in-memory buffer
    const buffer = await this.writeToBuffer(schema, [document]);

    // Upload to S3/R2
    await this.uploadToS3(key, buffer);

    return key;
  }

  /**
   * Write raw_pages Parquet to S3/R2
   * Path: md_raw_ocr/pages/doc_id={doc_id}/run_id={run_id}/part-000.parquet
   */
  async writePages(pages: RawPage[]): Promise<string> {
    if (pages.length === 0) {
      throw new Error('Cannot write empty pages array');
    }

    const { doc_id, run_id } = pages[0];
    const key = `md_raw_ocr/pages/doc_id=${doc_id}/run_id=${run_id}/part-000.parquet`;

    // Define Parquet schema
    const schema = new ParquetSchema({
      doc_id: { type: 'UTF8', optional: false },
      run_id: { type: 'INT64', optional: false },
      page_num: { type: 'INT32', optional: false },
      page_width: { type: 'DOUBLE', optional: true },
      page_height: { type: 'DOUBLE', optional: true },
      text: { type: 'UTF8', optional: true },
      text_sha256: { type: 'UTF8', optional: false },
      page_image_sha256: { type: 'UTF8', optional: true },
      ocr_confidence: { type: 'DOUBLE', optional: true },
      blocks_json: { type: 'UTF8', optional: true },
      lines_json: { type: 'UTF8', optional: true },
      tables_json: { type: 'UTF8', optional: true },
      figures_json: { type: 'UTF8', optional: true },
      ocr_runtime_ms: { type: 'INT64', optional: true },
      created_at: { type: 'TIMESTAMP_MILLIS', optional: false },
    });

    // Write to in-memory buffer
    const buffer = await this.writeToBuffer(schema, pages);

    // Upload to S3/R2
    await this.uploadToS3(key, buffer);

    return key;
  }

  /**
   * Write Parquet data to in-memory buffer
   */
  private async writeToBuffer(schema: ParquetSchema, rows: any[]): Promise<Buffer> {
    const buffers: Buffer[] = [];

    // Create a writable stream that collects chunks
    const writableStream = new WritableStream({
      write(chunk) {
        buffers.push(Buffer.from(chunk));
      },
    });

    const writer = await ParquetWriter.openStream(schema, writableStream);

    for (const row of rows) {
      await writer.appendRow(row);
    }

    await writer.close();

    return Buffer.concat(buffers);
  }

  /**
   * Upload buffer to S3/R2
   */
  private async uploadToS3(key: string, buffer: Buffer): Promise<void> {
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'application/octet-stream',
      },
    });

    await upload.done();
  }

  /**
   * Compute SHA256 hash of text
   */
  static async sha256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Compute SHA256 hash of binary data (PDF)
   */
  static async sha256Binary(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
