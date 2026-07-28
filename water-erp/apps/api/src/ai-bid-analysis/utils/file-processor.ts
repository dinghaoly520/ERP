// Shared file→text helper used by controller, TenderProcessor, and BidderProcessor
import * as mammoth from 'mammoth';
import { execFileSync } from 'node:child_process';
import { OcrService } from '../../local-ai/ocr.service';

/**
 * 尝试用 pdftotext 从 PDF 文本层提取文字（数字 PDF 秒级，比逐页 RapidOCR 快几个量级）。
 * 文本层过少（扫描件/纯图像 PDF）或工具不可用时返回 null，由调用方 fallback 到 OCR。
 */
function tryPdfTextLayer(buffer: Buffer): string | null {
  try {
    const out = execFileSync('pdftotext', ['-layout', '-', '-'], {
      input: buffer,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000, // 加密/损坏 PDF 交 poppler 可能卡死，限时强制返回降级 OCR
    });
    const text = out.toString('utf8');
    return text && text.trim().length > 500 ? text : null;
  } catch (e) {
    console.warn('[file-processor] pdftotext 不可用，降级 OCR（性能显著下降）:', (e as Error).message);
    return null;
  }
}

export async function processFile(
  ocrService: OcrService,
  buffer: Buffer,
  fileName?: string,
  maxPages = 200,
) {
  const ext = fileName?.toLowerCase().split('.').pop();

  // 纯文本类（txt/md/csv）— 直接按 UTF-8 读取，无需 OCR
  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    const text = buffer.toString('utf8');
    return { text, pages: [{ page: 1, text }], pageCount: 1 };
  }

  // DOCX — extract text directly (no OCR needed)。注意 mammoth 仅支持 docx，旧二进制 .doc 会抛错由调用方捕获。
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value,
      pages: [{ page: 1, text: result.value }],
      pageCount: 1,
    };
  }

  // PDF（数字版）— 优先 pdftotext 提文本层，秒级返回；文本层缺失才 fallback OCR
  if (ext === 'pdf') {
    const textLayer = tryPdfTextLayer(buffer);
    if (textLayer) {
      return {
        text: textLayer,
        pages: [{ page: 1, text: textLayer }],
        pageCount: 1,
      };
    }
  }

  // PDF（扫描件）/ images — use RapidOCR via OCR service
  const ocrResult = await ocrService.ocrPdf(buffer, maxPages, 150);
  return {
    text: ocrResult.text,
    pages: ocrResult.pages?.length
      ? ocrResult.pages
      : [{ page: 1, text: ocrResult.text }],
    pageCount: ocrResult.pageCount,
  };
}
