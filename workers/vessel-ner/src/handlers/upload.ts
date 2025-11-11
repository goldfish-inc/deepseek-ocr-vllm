/**
 * Upload Handler - Stage 1
 *
 * Receives PDF upload, stores in R2, enqueues for OCR processing
 */

import type { Context } from 'hono';

export async function uploadHandler(c: Context) {
  try {
    const formData = await c.req.formData();
    // Accept both 'pdf' and 'file' form field names
    const fileEntry = formData.get('pdf') || formData.get('file');

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
    console.log(JSON.stringify({
      event: 'sending_to_queue',
      queue: 'pdf-processing',
      message: {
        pdf_key: key,
        pdf_name: sanitizedName,
      },
    }));

    await c.env.PDF_PROCESSING_QUEUE.send({
      pdf_key: key,
      pdf_name: sanitizedName,
      uploaded_at: new Date().toISOString(),
    });

    // Write marker to R2 to prove upload handler executed BEFORE sending response
    let markerStatus = 'not_attempted';
    let markerError = null;
    const uploadMarkerKey = `upload-markers/${Date.now()}_${sanitizedName}.json`;
    try {
      await c.env.VESSEL_PDFS.put(uploadMarkerKey, JSON.stringify({
        event: 'upload_completed',
        pdf_key: key,
        pdf_name: sanitizedName,
        queued_to: 'pdf-processing',
        timestamp: new Date().toISOString(),
      }, null, 2));
      markerStatus = 'success';
    } catch (err) {
      markerStatus = 'failed';
      markerError = err instanceof Error ? err.message : String(err);
      console.error('Failed to write upload marker:', err);
    }

    console.log(JSON.stringify({
      event: 'pdf_uploaded_and_queued',
      key,
      size: file.size,
      upload_marker: uploadMarkerKey,
      marker_status: markerStatus,
      timestamp: new Date().toISOString(),
    }));

    return c.json({
      success: true,
      pdf_key: key,
      message: 'PDF uploaded successfully. Processing started.',
      debug: {
        marker_status: markerStatus,
        marker_error: markerError,
        check_r2: 'upload-markers/ and queue-triggers/',
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Upload failed', details: String(error) }, 500);
  }
}
