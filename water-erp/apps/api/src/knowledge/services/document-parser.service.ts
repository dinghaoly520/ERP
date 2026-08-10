import * as mammoth from 'mammoth';
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OcrService } from '../../local-ai/ocr.service';

 
const pdfParse = require('pdf-parse');
const execFileAsync = promisify(execFile);

const MIN_CHARS_PER_PAGE = 50;

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(private ocrService: OcrService) {}

  async parse(
    buffer: Buffer,
    mimeType: string,
    fileName?: string,
  ): Promise<string> {
    const isDocx =
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName?.endsWith('.docx');
    const isDoc =
      mimeType === 'application/msword' || fileName?.endsWith('.doc');
    const isPdf = mimeType === 'application/pdf' || fileName?.endsWith('.pdf');
    const isText =
      mimeType.startsWith('text/') ||
      fileName?.endsWith('.txt') ||
      fileName?.endsWith('.md');
    const isImage =
      mimeType.startsWith('image/') ||
      /\.(jpe?g|png|tiff?)$/i.test(fileName || '');

    if (isDocx) return this.parseDocx(buffer);
    if (isDoc) return this.parseDoc(buffer);
    if (isPdf) return this.parsePdf(buffer);
    if (isImage) return this.parseImage(buffer, mimeType, fileName || 'image');
    if (isText) return this.parseText(buffer);
    throw new Error(`Unsupported file type: ${mimeType} (${fileName})`);
  }

  /**
   * Parse PDF with OCR (for file analysis feature)
   * Always uses OCR for better content understanding
   */
  async parseWithOcr(buffer: Buffer, mimeType: string, fileName?: string): Promise<string> {
    const isPdf = mimeType === 'application/pdf' || fileName?.endsWith('.pdf');
    const isImage =
      mimeType.startsWith('image/') ||
      /\.(jpe?g|png|tiff?)$/i.test(fileName || '');

    if (isPdf) return this.parsePdfWithOcr(buffer);
    if (isImage) return this.parseImage(buffer, mimeType, fileName || 'image');

    // For other types, use regular parse
    return this.parse(buffer, mimeType, fileName);
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  /**
   * Parse PDF for field extraction (new project creation)
   * Uses pdf-parse first, only falls back to OCR if text is too sparse (scanned document)
   */
  private async parsePdf(buffer: Buffer): Promise<string> {
    // First try pdf-parse for native PDF text
    const data = await pdfParse(new Uint8Array(buffer));
    const text = data.text.trim();
    const numpages = data.numpages || 1;
    const charsPerPage = text.length / numpages;

    this.logger.log(
      `pdf-parse extracted ${text.length} chars from ${numpages} pages (${charsPerPage.toFixed(0)} chars/page)`,
    );

    // If we have enough text per page, it's likely a native PDF (not scanned)
    // Use this text directly for more accurate field extraction
    if (charsPerPage >= MIN_CHARS_PER_PAGE) {
      // 字符密度达标，但嵌入式字体 ToUnicode 映射缺失时 pdf-parse 会产生 U+FFFD 替换字符（中文丢字）。
      // 检测到乱码则回退 OCR（若可用）以恢复正确文本
      if (this.hasGarbledText(text)) {
        this.logger.warn(
          `pdf-parse text contains replacement chars (U+FFFD) — font ToUnicode likely missing, trying OCR recovery`,
        );
        if (await this.ocrService.isAvailable()) {
          try {
            const ocrResult = await this.ocrService.ocrPdf(buffer);
            if (ocrResult.text.trim() && !this.hasGarbledText(ocrResult.text)) {
              this.logger.log(
                `OCR recovered ${ocrResult.text.length} chars, replacing garbled pdf-parse output`,
              );
              return ocrResult.text;
            }
          } catch (err) {
            this.logger.warn(`OCR recovery failed: ${err}`);
          }
        }
      }
      this.logger.log('Using pdf-parse text (native PDF detected)');
      return text;
    }

    // Text is too sparse - likely a scanned document, try OCR
    this.logger.log('Text too sparse, trying OCR (scanned PDF detected)');
    const ocrAvailable = await this.ocrService.isAvailable();
    if (ocrAvailable) {
      try {
        const ocrResult = await this.ocrService.ocrPdf(buffer);
        if (ocrResult.text.trim().length > 0) {
          this.logger.log(
            `OCR extracted ${ocrResult.text.length} chars from ${ocrResult.processedPages} pages`,
          );
          return ocrResult.text;
        }
      } catch (err) {
        this.logger.warn(`OCR failed: ${err}`);
      }
    }

    // Return whatever text we got from pdf-parse
    return text;
  }

  /**
   * Parse PDF with OCR (for file analysis feature)
   * Always uses OCR for better content understanding
   */
  private async parsePdfWithOcr(buffer: Buffer): Promise<string> {
    const ocrAvailable = await this.ocrService.isAvailable();
    if (ocrAvailable) {
      try {
        this.logger.log('Using OCR for PDF analysis...');
        const ocrResult = await this.ocrService.ocrPdf(buffer);
        if (ocrResult.text.trim().length > 0) {
          this.logger.log(
            `OCR extracted ${ocrResult.text.length} chars from ${ocrResult.processedPages} pages`,
          );
          return ocrResult.text;
        }
      } catch (err) {
        this.logger.warn(`OCR failed, falling back to pdf-parse: ${err}`);
      }
    } else {
      this.logger.warn('OCR service unavailable, using pdf-parse fallback');
    }

    // Fallback to pdf-parse if OCR unavailable or failed
    const data = await pdfParse(new Uint8Array(buffer));
    const text = data.text.trim();
    this.logger.log(
      `pdf-parse extracted ${text.length} chars from ${data.numpages || 1} pages`,
    );
    if (this.hasGarbledText(text)) {
      this.logger.warn(
        `pdf-parse fallback contains replacement chars (U+FFFD) — OCR service unavailable, extracted text may have missing Chinese characters`,
      );
    }
    return text;
  }

  /**
   * 检测文本是否含 pdf-parse 字体映射缺失产生的替换字符（U+FFFD）。
   * 嵌入式子集字体若无 ToUnicode CMap，个别中文会被替换为 U+FFFD（渲染为 � 或 ???），
   * 此类乱码应触发 OCR 回退或在 AI 摘要阶段由上下文还原。
   */
  private hasGarbledText(text: string): boolean {
    return text.includes('�') || /\?{3,}/.test(text);
  }

  private async parseDoc(buffer: Buffer): Promise<string> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-'));
    const docPath = path.join(tmpDir, 'input.doc');
    const txtPath = path.join(tmpDir, 'input.txt');
    try {
      await fs.promises.writeFile(docPath, buffer);
      await execFileAsync('libreoffice', [
        '--headless',
        '--convert-to',
        'txt:Text',
        '--outdir',
        tmpDir,
        docPath,
      ]);
      const text = await fs.promises.readFile(txtPath, 'utf-8');
      return text;
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async parseText(buffer: Buffer): Promise<string> {
    return buffer.toString('utf-8');
  }

  private async parseImage(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const ocrAvailable = await this.ocrService.isAvailable();
    if (!ocrAvailable) {
      throw new Error(
        `Cannot extract text from image ${fileName}: OCR service unavailable`,
      );
    }
    const result = await this.ocrService.ocrImage(buffer, mimeType, fileName);
    return result.text;
  }
}
