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

  constructor(config: DeepSeekOcrConfig) {
    this.hfToken = config.hfToken;
    this.spaceUrl = config.spaceUrl;
  }

  /**
   * Process PDF with DeepSeek OCR via Gradio Space
   *
   * @param pdfBuffer - PDF file as ArrayBuffer
   * @param filename - Filename for tracking (e.g., "NPFC_2025_page_001")
   * @returns OCR text and metadata
   */
  async processPdf(pdfBuffer: ArrayBuffer, filename: string = "document"): Promise<DeepSeekOcrResponse[]> {
    try {
      // Convert space URL from full URL to space ID
      // https://huggingface.co/spaces/goldfish-inc/deepseekocr -> goldfish-inc/deepseekocr
      const spaceId = this.spaceUrl.replace('https://huggingface.co/spaces/', '');

      // Connect to private Gradio Space with auth
      const client = await Client.connect(spaceId, {
        hf_token: this.hfToken as `hf_${string}`,
      });

      // Convert ArrayBuffer to Blob for Gradio client
      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

      // Create File from Blob (Gradio expects File object)
      const pdfFile = new File([pdfBlob], `${filename}.pdf`, { type: 'application/pdf' });

      // Call the ocr_interface function (fn_index 0 - the first/only function in the Space)
      // Inputs: image, base_size=1024, save_results=False, filename=""
      // We don't want it to save to HF dataset (save_results=false) since we're writing to MotherDuck
      const result = await client.predict(0, [
        pdfFile,       // image parameter
        1024,          // base_size parameter
        false,         // save_results parameter - don't save to HF dataset
        filename       // filename parameter
      ]);

      // Parse Gradio response
      // The Space returns text output in result.data
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
      console.error('DeepSeek OCR error:', error);
      throw error;
    }
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
