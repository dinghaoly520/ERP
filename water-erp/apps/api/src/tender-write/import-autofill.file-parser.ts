import * as path from 'path';
import * as mammoth from 'mammoth';
// pdf-parse 是 CJS 包（module.exports = fn），无 esModuleInterop 时默认 import 编译为 .default → 运行时 undefined。
// 必须用 require 形式（见根 CLAUDE.md「TS import 约定」）。
import pdfParse = require('pdf-parse');
import type { OcrService } from '../local-ai/ocr.service';

export type ParsedFile = {
  name: string;
  text: string;
  /** 是否通过 OCR 提取（扫描件回退） */
  ocrUsed?: boolean;
};

export async function parseUploadedFile(
  fileBuffer: Buffer,
  originalName?: string,
  ocrService?: OcrService,
): Promise<ParsedFile> {
  const safeName = originalName || 'unknown.bin';
  const ext = path.extname(safeName).toLowerCase();
  const name = originalName || safeName;

  if (ext === '.doc') {
    throw new Error(
      `暂不支持 .doc 文件"${originalName}"，请另存为 .docx 后再上传。`,
    );
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    const text = result.value.trim();
    if (!text) {
      throw new Error(`文件"${originalName}"未提取到文本内容。`);
    }
    return { name, text };
  }

  if (ext === '.pdf') {
    // 先尝试直接提取文字层（普通 PDF）
    const data = await pdfParse(fileBuffer);
    const text = data.text.trim();
    if (text && text.length >= 20) {
      return { name, text };
    }

    // 扫描件（无文字层）：回退到 OCR
    if (ocrService) {
      const ocr = await ocrService.ocrPdf(fileBuffer);
      const ocrText = ocr.text?.trim();
      if (ocrText && ocrText.length >= 20) {
        return { name, text: ocrText, ocrUsed: true };
      }
    }

    throw new Error(
      `文件"${originalName}"未提取到足够文本内容，可能为扫描件且 OCR 失败。`,
    );
  }

  if (ext === '.md' || ext === '.txt') {
    const text = fileBuffer.toString('utf-8').trim();
    if (!text) {
      throw new Error(`文件"${originalName}"内容为空。`);
    }
    return { name, text };
  }

  throw new Error(`不支持的文件类型"${ext}"。`);
}
