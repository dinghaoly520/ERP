import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OcrResult {
  text: string;
  pageCount: number;
  processedPages: number;
  pages?: Array<{ page: number; text: string }>;
}

function toBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

@Injectable()
export class OcrService {
  private readonly baseUrls: string[];
  private rrIndex = 0;
  private readonly logger = new Logger(OcrService.name);

  // 批处理配置
  // 单副本 OCR 服务有 2 个并行 worker，每批 40 页 = 每个 worker 处理 20 页；
  // OCR_SERVICE_URL 配逗号多副本时，各批再 round-robin 分发到不同副本（见 nextBaseUrl）
  private readonly BATCH_PAGES = 40;
  private readonly LARGE_FILE_THRESHOLD_MB = 20;
  private readonly BATCH_DELAY_MS = 500;
  private readonly BATCH_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 500;

  constructor(private config: ConfigService) {
    const raw = config.get<string>('OCR_SERVICE_URL', 'http://localhost:8100');
    this.baseUrls = raw
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (this.baseUrls.length === 0) {
      this.baseUrls = ['http://localhost:8100'];
    }
    if (this.baseUrls.length > 1) {
      this.logger.log(
        `OCR 多副本模式：${this.baseUrls.join(', ')}（round-robin 分发）`,
      );
    }
  }

  /** round-robin 取下一个副本地址（请求无会话亲和，任意副本可服务任意请求） */
  private nextBaseUrl(): string {
    const url = this.baseUrls[this.rrIndex % this.baseUrls.length];
    this.rrIndex = (this.rrIndex + 1) % this.baseUrls.length;
    return url;
  }

  async isAvailable(): Promise<boolean> {
    for (const base of this.baseUrls) {
      try {
        const res = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) return true;
      } catch {
        // 试下一个副本
      }
    }
    return false;
  }

  /**
   * OCR 处理 PDF - 支持分批处理大文件
   *
   * 关键改进：使用 page_range 参数让 OCR 服务只处理指定页面范围
   * 这样避免了每次都处理整个 PDF 文件
   */
  async ocrPdf(buffer: Buffer, maxPages = 200, dpi = 150): Promise<OcrResult> {
    const fileSizeMB = buffer.length / (1024 * 1024);

    if (fileSizeMB <= this.LARGE_FILE_THRESHOLD_MB) {
      return this.ocrPdfSingle(buffer, maxPages, dpi, null);
    }

    // 大文件分批处理 - 使用 page_range 参数
    this.logger.log(
      `Large PDF (${fileSizeMB.toFixed(1)} MB), using batch processing with page_range`,
    );
    return this.ocrPdfBatched(buffer, maxPages, dpi);
  }

  /**
   * 单次 OCR 调用
   */
  private async ocrPdfSingle(
    buffer: Buffer,
    maxPages: number,
    dpi: number,
    pageRange: string | null,
  ): Promise<OcrResult> {
    const formData = new FormData();
    formData.append('file', new Blob([toBlobPart(buffer)]), 'document.pdf');
    formData.append('max_pages', String(maxPages));
    formData.append('dpi', String(dpi));
    if (pageRange) {
      formData.append('page_range', pageRange);
    }

    const rangeDesc = pageRange ? `pages ${pageRange}` : `${maxPages} pages`;
    this.logger.log(
      `OCR request: ${(buffer.length / 1024 / 1024).toFixed(1)} MB, ${rangeDesc}, dpi=${dpi}`,
    );

    const ocrBase = this.nextBaseUrl();
    const response = await fetch(`${ocrBase}/ocr`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300_000), // 单批 5 分钟超时
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `OCR request failed: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();
    this.logger.log(
      `OCR complete: ${data.processed_pages} pages, ${data.text.length} chars`,
    );
    return {
      text: data.text,
      pageCount: data.page_count,
      processedPages: data.processed_pages,
      pages: data.pages,
    };
  }

  /**
   * 分批 OCR 处理（大文件）
   *
   * 使用 page_range 参数，每批只让 OCR 服务处理 40 页
   * OCR 服务会在内部用 PyMuPDF 提取指定页面，再进行 OCR
   */
  private async ocrPdfBatched(
    buffer: Buffer,
    maxPages: number,
    dpi: number,
  ): Promise<OcrResult> {
    const totalPages = await this.getPdfPageCount(buffer);
    const effectivePages =
      maxPages > 0 ? Math.min(totalPages, maxPages) : totalPages;
    const batches = Math.ceil(effectivePages / this.BATCH_PAGES);
    const allPages: Array<{ page: number; text: string }> = [];

    this.logger.log(
      `Batch OCR: PDF has ${totalPages} pages, will process ${effectivePages} pages in ${batches} batches`,
    );

    for (let batch = 0; batch < batches; batch++) {
      const startPage = batch * this.BATCH_PAGES + 1;
      const endPage = Math.min((batch + 1) * this.BATCH_PAGES, effectivePages);
      const pageRange = `${startPage}-${endPage}`;

      this.logger.log(
        `Batch ${batch + 1}/${batches}: extracting pages ${pageRange}`,
      );

      const result = await this.ocrPdfBatchWithRetry(
        buffer,
        endPage - startPage + 1,
        dpi,
        pageRange,
        batch + 1,
      );

      const pages = this.normalizeBatchPages(result, startPage);
      allPages.push(...pages);

      this.logger.log(
        `Batch ${batch + 1} complete: ${result.processedPages} pages, total accumulated: ${allPages.length}`,
      );
    }

    const missingPages = this.findMissingPages(allPages, effectivePages);
    if (missingPages.length > 0) {
      throw new ServiceUnavailableException(
        `OCR batch result incomplete, missing pages: ${missingPages.join(', ')}`,
      );
    }

    const fullText = allPages.map((p) => p.text).join('\n\n');

    this.logger.log(
      `Batch OCR complete: ${allPages.length} pages, ${fullText.length} chars`,
    );

    return {
      text: fullText,
      pageCount: totalPages,
      processedPages: allPages.length,
      pages: allPages,
    };
  }

  private async getPdfPageCount(buffer: Buffer): Promise<number> {
    // 只 OCR 第 1 页即可获取总页数（PyMuPDF 在 page_count 字段返回总页数）
    const result = await this.ocrPdfSingle(buffer, 1, 50, '1-1');
    if (!result.pageCount || result.pageCount < 1) {
      throw new ServiceUnavailableException(
        'OCR service did not return a valid PDF page count',
      );
    }
    return result.pageCount;
  }

  private async ocrPdfBatchWithRetry(
    buffer: Buffer,
    maxPages: number,
    dpi: number,
    pageRange: string,
    batchNumber: number,
  ): Promise<OcrResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.BATCH_RETRIES; attempt++) {
      try {
        return await this.ocrPdfSingle(buffer, maxPages, dpi, pageRange);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Batch ${batchNumber} attempt ${attempt}/${this.BATCH_RETRIES} failed: ${error}`,
        );
        if (attempt < this.BATCH_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS);
        }
      }
    }

    this.logger.error(
      `Batch ${batchNumber} failed after ${this.BATCH_RETRIES} attempts: ${lastError}`,
    );
    throw lastError;
  }

  private normalizeBatchPages(
    result: OcrResult,
    startPage: number,
  ): Array<{ page: number; text: string }> {
    if (result.pages?.length) {
      return result.pages.map((p) => ({
        page: p.page + startPage - 1,
        text: p.text,
      }));
    }

    if (result.text) {
      return [{ page: startPage, text: result.text }];
    }

    return [];
  }

  private findMissingPages(
    pages: Array<{ page: number; text: string }>,
    expectedPages: number,
  ): number[] {
    const pageNumbers = new Set(pages.map((p) => p.page));
    const missing: number[] = [];
    for (let page = 1; page <= expectedPages; page++) {
      if (!pageNumbers.has(page)) {
        missing.push(page);
      }
    }
    return missing;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async ocrImage(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<OcrResult> {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([toBlobPart(buffer)], { type: mimeType }),
      filename,
    );

    const ocrBase = this.nextBaseUrl();
    const response = await fetch(`${ocrBase}/ocr`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `OCR service request failed: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();
    return {
      text: data.text,
      pageCount: data.page_count,
      processedPages: data.processed_pages,
    };
  }
}
