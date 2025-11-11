/**
 * DeepSeek OCR Client
 *
 * Calls goldfish-inc/deepseekocr HuggingFace Space for OCR extraction
 * Uses Gradio Client to connect to private Space
 */

import { Client } from '@gradio/client';

export interface DeepSeekOcrConfig {
  hfToken: string;
  spaceUrl: string;
  useDirectUpload?: boolean; // Feature flag: use direct HTTP FormData upload instead of @gradio/client
}

export interface DeepSeekOcrResponse {
  text: string;
  clean_text?: string;
  has_tables: boolean;
  metadata?: {
    page_number?: number;
    confidence?: number;
  };
}

/**
 * DeepSeek OCR Client for HuggingFace Spaces
 * Uses @gradio/client to connect to private Gradio Space
 */
export class DeepSeekOcrClient {
  private hfToken: string;
  private spaceUrl: string;
  private useDirectUpload: boolean;

  constructor(config: DeepSeekOcrConfig) {
    this.hfToken = config.hfToken;
    this.spaceUrl = config.spaceUrl;
    this.useDirectUpload = config.useDirectUpload ?? false;
  }

  /**
   * Process PDF with DeepSeek OCR via Gradio Space using URL
   *
   * @param pdfUrl - Public URL to PDF file (e.g., R2 public URL or signed URL)
   * @param filename - Filename for tracking (e.g., "NPFC_2025_page_001")
   * @returns OCR text and metadata
   */
  async processPdfFromUrl(pdfUrl: string, filename: string = "document"): Promise<DeepSeekOcrResponse[]> {
    try {
      const spaceId = this.spaceUrl.replace('https://huggingface.co/spaces/', '');
      console.log(JSON.stringify({
        event: 'deepseek_connecting',
        space_id: spaceId,
        has_token: !!this.hfToken,
        token_prefix: this.hfToken?.substring(0, 6),
      }));

      // Connect to private Gradio Space with auth
      const client = await Client.connect(spaceId, {
        hf_token: this.hfToken as `hf_${string}`,
      });
      console.log(JSON.stringify({
        event: 'deepseek_connected',
        space_id: spaceId,
      }));

      const safeName = filename?.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;

      console.log(JSON.stringify({
        event: 'deepseek_calling_predict_with_url',
        filename: safeName,
        pdf_url: pdfUrl,
        fn_index: 0,
      }));

      // Call predict with URL - Gradio's handle_file() equivalent
      // Pass FileData format: { url: string } or just the URL string
      const result = await client.predict("/ocr_api", [
        { url: pdfUrl },  // pdf_path as FileData with URL
        1024,             // base_size parameter
        false,            // save_results parameter - don't save to HF dataset
        safeName          // filename parameter (with .pdf for downstream tooling)
      ]);

      console.log(JSON.stringify({
        event: 'deepseek_predict_completed',
        has_data: !!result.data,
        data_type: typeof result.data,
      }));

      // Parse Gradio response
      const ocrText = result.data as string;

      // Extract clean text (remove markdown formatting if needed)
      const cleanText = this.cleanOcrText(ocrText);

      return [{
        text: ocrText,
        clean_text: cleanText,
        has_tables: ocrText.toLowerCase().includes('<table>') || ocrText.includes('|'),
        metadata: {
          page_number: 1,
          confidence: 1.0,
        },
      }];
    } catch (error) {
      console.error(JSON.stringify({
        event: 'deepseek_ocr_error',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        error_name: error instanceof Error ? error.name : undefined,
      }));
      throw error;
    }
  }

  /**
   * Process PDF with DeepSeek OCR via Gradio Space
   *
   * @param pdfBuffer - PDF file as ArrayBuffer
   * @param filename - Filename for tracking (e.g., "NPFC_2025_page_001")
   * @returns OCR text and metadata
   * @deprecated Use processPdfFromUrl() instead - blob upload incompatible with Cloudflare Workers
   */
  async processPdf(pdfBuffer: ArrayBuffer, filename: string = "document"): Promise<DeepSeekOcrResponse[]> {
    try {
      // Convert space URL from full URL to space ID
      // https://huggingface.co/spaces/goldfish-inc/deepseekocr -> goldfish-inc/deepseekocr
      const spaceId = this.spaceUrl.replace('https://huggingface.co/spaces/', '');
      console.log(JSON.stringify({
        event: 'deepseek_connecting',
        space_id: spaceId,
        has_token: !!this.hfToken,
        token_prefix: this.hfToken?.substring(0, 6),
      }));

      // Connect to private Gradio Space with auth
      const client = await Client.connect(spaceId, {
        hf_token: this.hfToken as `hf_${string}`,
      });
      console.log(JSON.stringify({
        event: 'deepseek_connected',
        space_id: spaceId,
      }));

      // In Cloudflare Workers, ensure we construct a proper Blob with metadata
      // Gradio Client expects a Blob, not a File object
      const uint8 = new Uint8Array(pdfBuffer);
      const safeName = filename?.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;

      // Create Blob with proper type
      const pdfBlob = new Blob([uint8], { type: 'application/pdf' });

      // Add name property to Blob (Gradio checks this)
      Object.defineProperty(pdfBlob, 'name', {
        value: safeName,
        writable: false,
        enumerable: true,
        configurable: true
      });

      // Debug: log Blob details
      console.log(JSON.stringify({
        event: 'blob_created',
        name: (pdfBlob as any).name,
        type: pdfBlob.type,
        size: pdfBlob.size,
        buffer_length: uint8.length,
      }));

      // Call the ocr_interface function (fn_index 0 - the first/only function in the Space)
      // Inputs: image, base_size=1024, save_results=False, filename=""
      // We don't want it to save to HF dataset (save_results=false) since we're writing to MotherDuck
      console.log(JSON.stringify({
        event: 'deepseek_calling_predict',
        filename: safeName,
        fn_index: 0,
        upload_method: this.useDirectUpload ? 'direct_http' : 'gradio_client',
      }));

      let ocrText: string;

      if (this.useDirectUpload) {
        // Feature flag enabled: Use direct HTTP API call with base64
        ocrText = await this.directPredictWithBase64(pdfBuffer, safeName);
      } else {
        // Default: Use @gradio/client with direct predict call
        // Gradio client automatically handles file upload when you pass File object
        console.log(JSON.stringify({
          event: 'calling_predict_with_file',
          space_id: spaceId,
          filename: safeName,
          size: uint8.length,
          api_name: '/ocr_api',
        }));

        // Call predict directly - Gradio client handles upload automatically
        const result = await client.predict("/ocr_api", [
          pdfBlob,  // pdf_path - Gradio client uploads this automatically
          1024,     // base_size parameter
          false,    // save_results parameter - don't save to HF dataset
          safeName  // filename parameter (with .pdf for downstream tooling)
        ]);

        console.log(JSON.stringify({
          event: 'deepseek_predict_completed',
          has_data: !!result.data,
          data_type: typeof result.data,
        }));

        // Parse Gradio response
        // The Space returns text output in result.data
        ocrText = result.data as string;
      }

      // Extract clean text (remove markdown formatting if needed)
      const cleanText = this.cleanOcrText(ocrText);

      return [{
        text: ocrText,
        clean_text: cleanText,
        has_tables: ocrText.toLowerCase().includes('<table>') || ocrText.includes('|'),
        metadata: {
          page_number: 1,
          confidence: 1.0,
        },
      }];
    } catch (error) {
      console.error(JSON.stringify({
        event: 'deepseek_ocr_error',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        error_name: error instanceof Error ? error.name : undefined,
      }));
      throw error;
    }
  }

  /**
   * Direct HTTP predict call to Gradio Space with base64 file data
   * Bypasses @gradio/client entirely and uses Gradio's REST API
   *
   * @param pdfBuffer - PDF as ArrayBuffer
   * @param filename - Filename with .pdf extension
   * @returns OCR text from Gradio Space
   */
  private async directPredictWithBase64(pdfBuffer: ArrayBuffer, filename: string): Promise<string> {
    // Construct HuggingFace Space API endpoint using Gradio's /call/ API
    // Format: https://goldfish-inc-deepseekocr.hf.space/call/ocr_api
    const spaceId = this.spaceUrl.replace('https://huggingface.co/spaces/', '');
    const spaceDomain = spaceId.replace('/', '-');
    const callUrl = `https://${spaceDomain}.hf.space/call/ocr_api`;

    console.log(JSON.stringify({
      event: 'gradio_call_starting',
      call_url: callUrl,
      filename,
      size: pdfBuffer.byteLength,
    }));

    // Convert to base64 (chunked to avoid call stack overflow on large files)
    const uint8 = new Uint8Array(pdfBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    const dataUri = `data:application/pdf;base64,${base64}`;

    console.log(JSON.stringify({
      event: 'base64_encoded',
      data_uri_prefix: dataUri.substring(0, 50),
      data_uri_length: dataUri.length,
    }));

    // Step 1: Initiate call to get event_id
    // ocr_api(pdf_path, base_size=1024, save_results=False, filename="")
    const callResponse = await fetch(callUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.hfToken}`,
      },
      body: JSON.stringify({
        data: [
          dataUri,      // pdf_path as base64 data URI
          1024,         // base_size parameter
          false,        // save_results parameter
          filename      // filename parameter
        ],
      }),
    });

    if (!callResponse.ok) {
      const errorText = await callResponse.text();
      throw new Error(`Gradio /call failed: ${callResponse.status} ${errorText}`);
    }

    const callResult = await callResponse.json() as { event_id?: string; error?: string };

    if (callResult.error) {
      throw new Error(`Gradio call error: ${callResult.error}`);
    }

    if (!callResult.event_id) {
      throw new Error(`No event_id in call response: ${JSON.stringify(callResult)}`);
    }

    const eventId = callResult.event_id;

    console.log(JSON.stringify({
      event: 'gradio_call_initiated',
      event_id: eventId,
    }));

    // Step 2: Poll /call/ocr_api/{event_id} for results
    const resultUrl = `${callUrl}/${eventId}`;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max wait

    while (attempts < maxAttempts) {
      const resultResponse = await fetch(resultUrl, {
        headers: {
          'Authorization': `Bearer ${this.hfToken}`,
        },
      });

      if (!resultResponse.ok) {
        throw new Error(`Gradio result fetch failed: ${resultResponse.status}`);
      }

      const resultText = await resultResponse.text();

      // Gradio streams results as Server-Sent Events (SSE)
      // Format: data: {"event": "complete", "output": {"data": [...]}}\n\n
      const lines = resultText.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6); // Remove 'data: ' prefix

          try {
            const eventData = JSON.parse(jsonStr);

            if (eventData.event === 'complete') {
              const ocrText = eventData.output?.data?.[0];

              if (typeof ocrText === 'string') {
                console.log(JSON.stringify({
                  event: 'gradio_call_success',
                  text_length: ocrText.length,
                }));

                return ocrText;
              }
            }

            if (eventData.event === 'error') {
              throw new Error(`Gradio processing error: ${eventData.output}`);
            }

          } catch (parseError) {
            // Ignore parse errors for non-JSON lines
            continue;
          }
        }
      }

      // Wait 1 second before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error(`Timeout waiting for OCR results after ${maxAttempts} seconds`);
  }

  /**
   * Clean OCR output text
   * Remove Gradio status messages and extract actual OCR content
   */
  private cleanOcrText(text: string): string {
    // Remove progress messages like "🔄 Processing..."
    let cleaned = text.replace(/[🔄✅❌💾⏱️]/g, '');
    cleaned = cleaned.replace(/Processing image.*?\n/g, '');
    cleaned = cleaned.replace(/OCR completed.*?\n/g, '');
    cleaned = cleaned.replace(/Processing time:.*?\n/g, '');
    cleaned = cleaned.replace(/---\n/g, '');
    cleaned = cleaned.replace(/## OCR Output\n/g, '');

    return cleaned.trim();
  }
}
