import * as mammoth from 'mammoth';
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OcrService, OCR_UNLIMITED_PAGES } from '../../local-ai/ocr.service';


const pdfParse = require('pdf-parse');
const execFileAsync = promisify(execFile);

const MIN_CHARS_PER_PAGE = 50;

/** 解析进度回调：processed/total 为页数（OCR 批次粒度）；total 在页数探测后即首次上报。
 *  类型保持 void（特例兼容同步任意返回/异步 Promise）——消费链路 await 后异步抛错=协作式取消（2026-11-09）。 */
export type ParseProgressFn = (processed: number, total: number) => void;

/** 解析选项（2026-11-10）。
 *  strictOcr 严格模式（知识库后台解析用）：扫描件（pdf-parse 稀疏）OCR 不可用/抛错/空结果时
 *  直接抛错——由 KnowledgeParseProcessor 落 FAILED，前端展示「解析失败」徽章+一键重试。
 *  生产实录：476 页扫描件 OCR 批 fetch failed 被 parsePdf 吞掉，返回残稀文本被误标
 *  READY(1 chunk, indexed=true)，前端永无失败提示。
 *  默认 false：存量消费方（project-management 字段提取等）维持「OCR 失败退回 pdf-parse 残文本」的宽容降级。 */
export interface ParseOptions {
  strictOcr?: boolean;
}

/** 单发进度上报（非批循环路径）：消费端回调可能为异步，且其中检查点会抛协作式取消——
 *  此处不 await（值无需回传），拒绝必须就地吞掉：取消语义由 processor 的前后检查点收口，
 *  浮动 rejection 会崩掉整个 worker 进程（2026-11-09 实录，Node 默认 unhandled-rejections=throw）。 */
function reportProgress(
  onProgress: ParseProgressFn | undefined,
  processed: number,
  total: number,
): void {
  Promise.resolve(onProgress?.(processed, total)).catch(() => undefined);
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(private ocrService: OcrService) {}

  async parse(
    buffer: Buffer,
    mimeType: string,
    fileName?: string,
    onProgress?: ParseProgressFn,
    options?: ParseOptions,
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

    // 单件类型（docx/doc/image/txt）无页概念，回填 (1,1) 防「0/?页」显示缺口
    if (isDocx) { reportProgress(onProgress, 1, 1); return this.parseDocx(buffer); }
    if (isDoc) { reportProgress(onProgress, 1, 1); return this.parseDoc(buffer); }
    if (isPdf) return this.parsePdf(buffer, onProgress, options);
    if (isImage) { reportProgress(onProgress, 1, 1); return this.parseImage(buffer, mimeType, fileName || 'image'); }
    if (isText) { reportProgress(onProgress, 1, 1); return this.parseText(buffer); }
    throw new Error(`不支持的文件类型：${fileName ?? ''}（${mimeType}）`);
  }

  /**
   * Parse PDF with OCR (for file analysis feature)
   * Always uses OCR for better content understanding
   */
  async parseWithOcr(
    buffer: Buffer,
    mimeType: string,
    fileName?: string,
    onProgress?: ParseProgressFn,
  ): Promise<string> {
    const isPdf = mimeType === 'application/pdf' || fileName?.endsWith('.pdf');
    const isImage =
      mimeType.startsWith('image/') ||
      /\.(jpe?g|png|tiff?)$/i.test(fileName || '');

    if (isPdf) return this.parsePdfWithOcr(buffer, onProgress);
    if (isImage) return this.parseImage(buffer, mimeType, fileName || 'image');

    // For other types, use regular parse
    return this.parse(buffer, mimeType, fileName, onProgress);
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  /**
   * Parse PDF for field extraction (new project creation)
   * Uses pdf-parse first, only falls back to OCR if text is too sparse (scanned document)
   */
  private async parsePdf(
    buffer: Buffer,
    onProgress?: ParseProgressFn,
    options?: ParseOptions,
  ): Promise<string> {
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
            const ocrResult = await this.ocrService.ocrPdf(
              buffer,
              OCR_UNLIMITED_PAGES,
              onProgress,
            );
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
      reportProgress(onProgress, numpages, numpages); // 快速路径页数回填（2026-11-06 显示缺口）
      return text;
    }

    // Text is too sparse - likely a scanned document, try OCR
    this.logger.log('Text too sparse, trying OCR (scanned PDF detected)');
    const ocrAvailable = await this.ocrService.isAvailable();
    if (!ocrAvailable && options?.strictOcr) {
      // 扫描件唯一可读来源是 OCR：严格模式下不可用即失败，不得以残稀文本冒充解析成功
      throw new Error('OCR 服务不可用，无法解析扫描件，请稍后重试');
    }
    if (ocrAvailable) {
      let ocrResult: Awaited<ReturnType<OcrService['ocrPdf']>> | undefined;
      try {
        ocrResult = await this.ocrService.ocrPdf(
          buffer,
          OCR_UNLIMITED_PAGES,
          onProgress,
        );
      } catch (err) {
        if (options?.strictOcr) {
          // 2026-11-10 生产实录：OCR 批失败（fetch failed）曾被吞，残稀文本误标 READY。
          // 严格模式透传——processor 落 FAILED；已完成 OCR 批次有 Redis 缓存，前端重试很快
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`OCR 解析失败：${reason}。请点击重试或重新上传`);
        }
        this.logger.warn(`OCR failed: ${err}`);
      }
      if (ocrResult) {
        if (ocrResult.text.trim().length > 0) {
          this.logger.log(
            `OCR extracted ${ocrResult.text.length} chars from ${ocrResult.processedPages} pages`,
          );
          return ocrResult.text;
        }
        if (options?.strictOcr) {
          // OCR 正常返回但零文本——不得以空内容冒充解析成功
          throw new Error('OCR 未从该文档提取到文本（扫描件可能无文字层），请确认文件后重新上传');
        }
      }
    }

    // Return whatever text we got from pdf-parse
    reportProgress(onProgress, numpages, numpages); // OCR 兜底未走成——pdf-parse 结果的页数回填
    return text;
  }

  /**
   * Parse PDF with OCR (for file analysis feature)
   * Always uses OCR for better content understanding
   */
  private async parsePdfWithOcr(buffer: Buffer, onProgress?: ParseProgressFn): Promise<string> {
    const ocrAvailable = await this.ocrService.isAvailable();
    if (ocrAvailable) {
      try {
        this.logger.log('Using OCR for PDF analysis...');
        const ocrResult = await this.ocrService.ocrPdf(
          buffer,
          OCR_UNLIMITED_PAGES,
          onProgress,
        );
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
    reportProgress(onProgress, data.numpages || 1, data.numpages || 1);
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
