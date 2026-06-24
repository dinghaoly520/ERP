// Shared file→text helper used by controller, TenderProcessor, and BidderProcessor
import * as mammoth from 'mammoth';
import { OcrService } from '../../local-ai/ocr.service';

export async function processFile(
  ocrService: OcrService,
  buffer: Buffer,
  fileName?: string,
  maxPages = 200,
) {
  const ext = fileName?.toLowerCase().split('.').pop();

  // DOCX — extract text directly (no OCR needed)
  if (ext === 'docx' || ext === 'doc') {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value,
      pages: [{ page: 1, text: result.value }],
      pageCount: 1,
    };
  }

  // PDF / images — use RapidOCR via OCR service
  const ocrResult = await ocrService.ocrPdf(buffer, maxPages, 300);
  return {
    text: ocrResult.text,
    pages: ocrResult.pages?.length
      ? ocrResult.pages
      : [{ page: 1, text: ocrResult.text }],
    pageCount: ocrResult.pageCount,
  };
}
