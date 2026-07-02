import * as mammoth from 'mammoth';
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OcrService } from '../../local-ai/ocr.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
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
    return text;
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
