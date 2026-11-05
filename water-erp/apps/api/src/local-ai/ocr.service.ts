import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'crypto';

export interface OcrResult {
  text: string;
  pageCount: number;
  processedPages: number;
  pages?: Array<{ page: number; text: string }>;
}

/**
 * 页数不截断哨兵（2026-11-05 用户裁定：文件有多少页就处理多少页）。
 * 值仅作实际上限保护（防手滑传入病态值），远超任何真实文档页数；
 * 服务端 max_pages=0 是「零 OCR 页数探测」专用语义，与此无关。
 */
export const OCR_UNLIMITED_PAGES = 1_000_000;

function toBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

@Injectable()
export class OcrService {
  private readonly baseUrls: string[];
  private rrIndex = 0;
  private readonly logger = new Logger(OcrService.name);

  // 批处理与缓存常量——消费端零配置面（用户裁定 2026-11-05）：
  // 性能与行为调参全部收敛到 services/ocr/.env 单一配置面，这里只保留代码常量。
  // 单副本 OCR 服务有 2 个并行 worker，每批 40 页 = 每 worker 20 页；
  // OCR_SERVICE_URL 配逗号多副本时，各批再 round-robin 分发到不同副本（见 nextBaseUrl）
  private readonly BATCH_PAGES = 40;
  // 结果缓存：内容哈希键，rerun/重试零重复计算；故障不阻断 OCR（仅随 Redis 缺席禁用）
  private readonly cacheEnabled: boolean;
  private readonly CACHE_TTL_SECONDS = 7 * 24 * 3600;
  private readonly CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
  private readonly LARGE_FILE_THRESHOLD_MB = 20;
  private readonly BATCH_DELAY_MS = 500;
  private readonly BATCH_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 500;

  constructor(
    private config: ConfigService,
    // @Global RedisModule 的 token；worker 进程可能未导入该模块 → Optional 缺席即禁用缓存
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis | null,
  ) {
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
    this.cacheEnabled = !!this.redis;
  }

  // ── OCR 结果缓存（Redis）──

  /** 缓存键：scope + 文件内容哈希 + 影响产出的请求参数（dpi 由服务端统一掌控，不入键） */
  private cacheKey(
    scope: 'pdf' | 'img',
    buffer: Buffer,
    maxPages: number = 0,
    pageRange: string | null = null,
  ): string {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 40);
    return `ocr:v1:${scope}:${hash}:${maxPages}:${pageRange ?? 'all'}`;
  }

  private async cacheGet(key: string): Promise<OcrResult | null> {
    if (!this.cacheEnabled || !this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as OcrResult;
    } catch (e) {
      this.logger.warn(`OCR cache get failed (${key.slice(0, 60)}…): ${e}`);
      return null;
    }
  }

  private async cacheSet(key: string, result: OcrResult): Promise<void> {
    if (!this.cacheEnabled || !this.redis) return;
    try {
      const raw = JSON.stringify(result);
      if (Buffer.byteLength(raw) > this.CACHE_MAX_ENTRY_BYTES) {
        this.logger.log(
          `OCR cache skip store (${key.slice(0, 60)}…): ` +
            `${Math.round(Buffer.byteLength(raw) / 1024)}KB 超条目上限`,
        );
        return;
      }
      await this.redis.set(key, raw, 'EX', this.CACHE_TTL_SECONDS);
    } catch (e) {
      this.logger.warn(`OCR cache set failed (${key.slice(0, 60)}…): ${e}`);
    }
  }

  /** 响应体 JSON 解析守卫：非 JSON（代理错误页等）归一为 ServiceUnavailableException */
  private async parseJsonResponse(response: any): Promise<any> {
    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(
        `OCR service returned non-JSON (status ${response.status}): ${raw.slice(0, 200)}`,
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

  /** 逐副本 healthz 探活（系统健康页用）：每副本可用性与延迟 */
  async probeReplicas(): Promise<Array<{ url: string; ok: boolean; latencyMs: number }>> {
    return Promise.all(this.baseUrls.map(async (base) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
        return { url: base, ok: res.ok, latencyMs: Date.now() - t0 };
      } catch {
        return { url: base, ok: false, latencyMs: Date.now() - t0 };
      }
    }));
  }

  /**
   * OCR 处理 PDF - 支持分批处理大文件
   *
   * 关键改进：使用 page_range 参数让 OCR 服务只处理指定页面范围
   * 这样避免了每次都处理整个 PDF 文件
   *
   * dpi 不再由消费端指定——统一走服务端 OCR_DEFAULT_DPI（单一配置面，2026-11-05 裁定）
   */
  async ocrPdf(
    buffer: Buffer,
    maxPages = OCR_UNLIMITED_PAGES,
  ): Promise<OcrResult> {
    const key = this.cacheKey('pdf', buffer, maxPages, null);
    const cached = await this.cacheGet(key);
    if (cached) {
      this.logger.log('OCR cache hit (pdf)');
      return cached;
    }

    const result = await this.ocrPdfUncached(buffer, maxPages);
    await this.cacheSet(key, result);
    return result;
  }

  private async ocrPdfUncached(
    buffer: Buffer,
    maxPages: number,
  ): Promise<OcrResult> {
    const fileSizeMB = buffer.length / (1024 * 1024);

    if (fileSizeMB <= this.LARGE_FILE_THRESHOLD_MB) {
      return this.ocrPdfSingle(buffer, maxPages, null);
    }

    // 大文件分批处理 - 使用 page_range 参数
    this.logger.log(
      `Large PDF (${fileSizeMB.toFixed(1)} MB), using batch processing with page_range`,
    );
    return this.ocrPdfBatched(buffer, maxPages);
  }

  /**
   * 单次 OCR 调用（不携带 dpi——服务端默认生效）
   */
  private async ocrPdfSingle(
    buffer: Buffer,
    maxPages: number,
    pageRange: string | null,
  ): Promise<OcrResult> {
    const formData = new FormData();
    formData.append('file', new Blob([toBlobPart(buffer)]), 'document.pdf');
    formData.append('max_pages', String(maxPages));
    if (pageRange) {
      formData.append('page_range', pageRange);
    }

    const rangeDesc = pageRange ? `pages ${pageRange}` : `${maxPages} pages`;
    this.logger.log(
      `OCR request: ${(buffer.length / 1024 / 1024).toFixed(1)} MB, ${rangeDesc}`,
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

    const data = await this.parseJsonResponse(response);
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
    // max_pages=0 且无 page_range：服务端零 OCR 早返回页数（原实现 OCR 第 1 页纯浪费）。
    // 与批处理同权重的重试（探测也吃 BATCH_RETRIES/RETRY_DELAY_MS）。
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.BATCH_RETRIES; attempt++) {
      try {
        const result = await this.ocrPdfSingle(buffer, 0, null);
        if (!result.pageCount || result.pageCount < 1) {
          throw new ServiceUnavailableException(
            'OCR service did not return a valid PDF page count',
          );
        }
        return result.pageCount;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Page count probe attempt ${attempt}/${this.BATCH_RETRIES} failed: ${error}`,
        );
        if (attempt < this.BATCH_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS);
        }
      }
    }
    throw lastError;
  }

  private async ocrPdfBatchWithRetry(
    buffer: Buffer,
    maxPages: number,
    pageRange: string,
    batchNumber: number,
  ): Promise<OcrResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.BATCH_RETRIES; attempt++) {
      try {
        return await this.ocrPdfSingle(buffer, maxPages, pageRange);
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
    const key = this.cacheKey('img', buffer);
    const cached = await this.cacheGet(key);
    if (cached) {
      this.logger.log('OCR cache hit (img)');
      return cached;
    }

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

    const data = await this.parseJsonResponse(response);
    const result: OcrResult = {
      text: data.text,
      pageCount: data.page_count,
      processedPages: data.processed_pages,
    };
    await this.cacheSet(key, result);
    return result;
  }
}
