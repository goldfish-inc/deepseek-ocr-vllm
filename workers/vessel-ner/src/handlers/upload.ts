/**
 * Upload Handler - Stage 1
 *
 * Receives PDF upload, stores in R2, enqueues for OCR processing
 */

import type { Context } from 'hono';

export async function uploadHandler(c: Context) {
  try {
    const formData = await c.req.formData();
    const fileEntry = formData.get('pdf');

    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ error: 'No PDF file provided' }, 400);
    }

    const file = fileEntry as File;

    // Validate PDF
    if (!file.type.includes('pdf') && !file.name.endsWith('.pdf')) {
      return c.json({ error: 'File must be a PDF' }, 400);
    }

    // Generate unique key
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${timestamp}_${sanitizedName}`;

    // Upload to R2
    await c.env.VESSEL_PDFS.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: 'application/pdf',
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        size: file.size.toString(),
      },
    });

    // Enqueue for OCR processing
    await c.env.PDF_PROCESSING_QUEUE.send({
      pdf_key: key,
      pdf_name: sanitizedName,
      uploaded_at: new Date().toISOString(),
    });

    console.log(JSON.stringify({
      event: 'pdf_uploaded',
      key,
      size: file.size,
      timestamp: new Date().toISOString(),
    }));

    return c.json({
      success: true,
      pdf_key: key,
      message: 'PDF uploaded successfully. Processing started.',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Upload failed', details: String(error) }, 500);
  }
}
