/**
 * Parquet Writer for MotherDuck Raw OCR Schema
 *
 * Writes OCR results to Parquet files in S3/R2 compatible with md_raw_ocr schema
 * Uses parquet-wasm for WebAssembly-based Parquet writing compatible with Workers
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as arrow from 'apache-arrow';
import initWasm, { writeParquet, Table, WriterPropertiesBuilder, Compression } from 'parquet-wasm';

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
 * Parquet Writer for md_raw_ocr schema using parquet-wasm
 */
export class MdRawOcrParquetWriter {
  private s3Client: S3Client;
  private bucket: string;
  private wasmInitialized: Promise<void>;

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

    // Initialize WASM module once
    this.wasmInitialized = initWasm();
  }

  /**
   * Write raw_documents Parquet to S3/R2
   * Path: md_raw_ocr/documents/date=YYYY-MM-DD/doc_id={doc_id}/run_id={run_id}/part-000.parquet
   */
  async writeDocuments(document: RawDocument): Promise<string> {
    await this.wasmInitialized;

    const date = document.ingest_ts.toISOString().split('T')[0];
    const key = `md_raw_ocr/documents/date=${date}/doc_id=${document.doc_id}/run_id=${document.run_id}/part-000.parquet`;

    // Create Arrow table from document data
    const table = arrow.tableFromArrays({
      doc_id: [document.doc_id],
      run_id: [document.run_id],
      ingest_ts: [document.ingest_ts],
      filename: [document.filename],
      r2_key: [document.r2_key],
      content_type: [document.content_type],
      size_bytes: [document.size_bytes],
      doc_sha256: [document.doc_sha256],
      uploader: [document.uploader],
      source_meta_json: [document.source_meta_json],
      hf_space_commit: [document.hf_space_commit],
      ocr_model: [document.ocr_model],
      ocr_image_digest: [document.ocr_image_digest],
      ocr_params_json: [document.ocr_params_json],
    });

    // Convert to Parquet
    const parquetBuffer = await this.writeToParquet(table);

    // Upload to S3/R2
    await this.uploadToS3(key, parquetBuffer);

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

    await this.wasmInitialized;

    const { doc_id, run_id } = pages[0];
    const key = `md_raw_ocr/pages/doc_id=${doc_id}/run_id=${run_id}/part-000.parquet`;

    // Create Arrow table from pages data
    const table = arrow.tableFromArrays({
      doc_id: pages.map(p => p.doc_id),
      run_id: pages.map(p => p.run_id),
      page_num: Int32Array.from(pages.map(p => p.page_num)),
      page_width: Float64Array.from(pages.map(p => p.page_width ?? 0)),
      page_height: Float64Array.from(pages.map(p => p.page_height ?? 0)),
      text: pages.map(p => p.text),
      text_sha256: pages.map(p => p.text_sha256),
      page_image_sha256: pages.map(p => p.page_image_sha256),
      ocr_confidence: Float64Array.from(pages.map(p => p.ocr_confidence ?? 0)),
      blocks_json: pages.map(p => p.blocks_json),
      lines_json: pages.map(p => p.lines_json),
      tables_json: pages.map(p => p.tables_json),
      figures_json: pages.map(p => p.figures_json),
      ocr_runtime_ms: pages.map(p => p.ocr_runtime_ms),
      created_at: pages.map(p => p.created_at),
    });

    // Convert to Parquet
    const parquetBuffer = await this.writeToParquet(table);

    // Upload to S3/R2
    await this.uploadToS3(key, parquetBuffer);

    return key;
  }

  /**
   * Convert Arrow table to Parquet using parquet-wasm
   */
  private async writeToParquet(table: arrow.Table): Promise<Uint8Array> {
    // Serialize Arrow table to IPC stream format
    const ipcStream = arrow.tableToIPC(table, 'stream');

    // Convert to WASM Table
    const wasmTable = Table.fromIPCStream(ipcStream);

    // Configure Parquet writer with ZSTD compression
    const writerProps = new WriterPropertiesBuilder()
      .setCompression(Compression.ZSTD)
      .build();

    // Write Parquet and return Uint8Array
    const parquetBuffer = writeParquet(wasmTable, writerProps);

    return parquetBuffer;
  }

  /**
   * Upload buffer to S3/R2
   */
  private async uploadToS3(key: string, buffer: Uint8Array): Promise<void> {
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
