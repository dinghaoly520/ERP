import {
  Injectable,
  ServiceUnavailableException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VllmMonitorService } from './vllm-monitor.service';

@Injectable()
export class EmbeddingService {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(forwardRef(() => VllmMonitorService))
    private readonly vllmMonitor: VllmMonitorService,
  ) {
    this.baseUrl = config.get<string>(
      'EMBEDDING_BASE_URL',
      'http://localhost:8001/v1',
    );
    this.model = config.get<string>('EMBEDDING_MODEL', 'BAAI/bge-m3');
    this.apiKey = config.get<string>('EMBEDDING_API_KEY', '');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.vllmMonitor.isEmbeddingAvailable()) {
      throw new ServiceUnavailableException(
        'Embedding service unavailable. Please check vLLM status.',
      );
    }

    if (texts.length === 0) return [];

    // 2026-11-09 生产实录：llama.cpp 版 bge-m3（4 核）批 32 条×~700token 单请求需
    // 220-240s，叠加并发分抢 slot 后打穿 undici 默认 headersTimeout(300s) →
    // UND_ERR_HEADERS_TIMEOUT → 一次失败整单降级。批降为 4：单请求 ~15-30s，
    // 与一切超时窗（undici 300s / 本层 120s 显式闸）保持 4-10× 余量。
    const batchSize = 4;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await this.embedBatchWithRetry(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /** 连接层失败重试（2026-11-09）：undici headersTimeout/连接抖动属瞬态，
   *  重试×2 指数退避；HTTP 明确拒绝（ServiceUnavailableException 应答类）不重试——
   *  服务端语义拒绝重试有害。 */
  private async embedBatchWithRetry(texts: string[]): Promise<number[][]> {
    const delaysMs = [2_000, 8_000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, delaysMs[attempt - 1]));
      try {
        return await this.embedBatch(texts);
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
      // 单批 120s 显式闸：卡死批快速进重试，不赌 undici 隐式 300s
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Embedding API request failed: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);
  }
}
