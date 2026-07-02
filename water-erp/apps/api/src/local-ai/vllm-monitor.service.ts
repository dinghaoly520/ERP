import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

interface ServiceStatus {
  online: boolean;
  url: string;
  model: string;
  failCount: number;
  lastCheck: Date | null;
  lastError: string | null;
}

@Injectable()
export class VllmMonitorService implements OnModuleInit {
  private readonly logger = new Logger(VllmMonitorService.name);

  private readonly llmUrl: string;
  private readonly llmModel: string;
  private readonly embeddingUrl: string;
  private readonly embeddingModel: string;

  private llmStatus: ServiceStatus;
  private embeddingStatus: ServiceStatus;

  private readonly probeTimeoutMs: number;
  private readonly offlineThreshold: number;

  constructor(private readonly config: ConfigService) {
    this.llmUrl = this.config.get<string>('LLM_BASE_URL', '');
    this.llmModel = this.config.get<string>('LLM_MODEL', 'qwen3.6-35b');
    this.embeddingUrl = this.config.get<string>('EMBEDDING_BASE_URL', '');
    this.embeddingModel = this.config.get<string>(
      'EMBEDDING_MODEL',
      'BAAI/bge-m3',
    );

    this.probeTimeoutMs = this.config.get<number>('VLLM_PROBE_TIMEOUT', 30_000);
    this.offlineThreshold = this.config.get<number>(
      'VLLM_OFFLINE_THRESHOLD',
      3,
    );

    this.llmStatus = {
      online: false,
      url: this.llmUrl,
      model: this.llmModel,
      failCount: 0,
      lastCheck: null,
      lastError: null,
    };

    this.embeddingStatus = {
      online: false,
      url: this.embeddingUrl,
      model: this.embeddingModel,
      failCount: 0,
      lastCheck: null,
      lastError: null,
    };
  }

  onModuleInit() {
    if (!this.llmUrl) {
      this.logger.log('LLM_BASE_URL not configured — local LLM probe disabled (using DeepSeek API instead)');
    }
    if (!this.embeddingUrl) {
      this.logger.warn('EMBEDDING_BASE_URL not configured — embedding probe disabled');
    }
    this.check();
  }

  @Interval(300_000)
  async check() {
    if (this.llmUrl) {
      await this.probeLlm();
    }
    if (this.embeddingUrl) {
      await this.probeEmbedding();
    }
  }

  isLlmAvailable(): boolean {
    return this.llmStatus.online;
  }

  isEmbeddingAvailable(): boolean {
    return this.embeddingStatus.online;
  }

  getStatus() {
    return {
      llm: {
        online: this.llmStatus.online,
        url: this.llmStatus.url,
        model: this.llmStatus.model,
        lastCheck: this.llmStatus.lastCheck,
        lastError: this.llmStatus.lastError,
      },
      embedding: {
        online: this.embeddingStatus.online,
        url: this.embeddingStatus.url,
        model: this.embeddingStatus.model,
        lastCheck: this.embeddingStatus.lastCheck,
        lastError: this.embeddingStatus.lastError,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async probeLlm(): Promise<void> {
    const prevOnline = this.llmStatus.online;
    const result = await this.probeEndpoint(
      this.llmUrl,
      this.llmModel,
      this.probeTimeoutMs,
    );

    this.llmStatus.lastCheck = new Date();

    if (result.ok) {
      this.llmStatus.failCount = 0;
      this.llmStatus.online = true;
      this.llmStatus.lastError = null;

      if (!prevOnline) {
        this.logger.log(`LLM service recovered — ${this.llmUrl}`);
      }
    } else {
      this.llmStatus.failCount++;
      this.llmStatus.lastError = result.error || null;

      if (this.llmStatus.failCount >= this.offlineThreshold) {
        if (prevOnline) {
          this.logger.error(
            `LLM OFFLINE — ${this.llmUrl} (failed ${this.llmStatus.failCount} times): ${result.error}`,
          );
        }
        this.llmStatus.online = false;
      } else {
        this.logger.warn(
          `LLM probe failed (${this.llmStatus.failCount}/${this.offlineThreshold}): ${result.error}`,
        );
      }
    }
  }

  private async probeEmbedding(): Promise<void> {
    const prevOnline = this.embeddingStatus.online;
    const timeoutMs = Math.min(this.probeTimeoutMs, 15_000);
    const result = await this.probeEndpoint(
      this.embeddingUrl,
      this.embeddingModel,
      timeoutMs,
    );

    this.embeddingStatus.lastCheck = new Date();

    if (result.ok) {
      this.embeddingStatus.failCount = 0;
      this.embeddingStatus.online = true;
      this.embeddingStatus.lastError = null;

      if (!prevOnline) {
        this.logger.log(`Embedding service recovered — ${this.embeddingUrl}`);
      }
    } else {
      this.embeddingStatus.failCount++;
      this.embeddingStatus.lastError = result.error || null;

      if (this.embeddingStatus.failCount >= this.offlineThreshold) {
        if (prevOnline) {
          this.logger.error(
            `Embedding OFFLINE — ${this.embeddingUrl} (failed ${this.embeddingStatus.failCount} times): ${result.error}`,
          );
        }
        this.embeddingStatus.online = false;
      } else {
        this.logger.warn(
          `Embedding probe failed (${this.embeddingStatus.failCount}/${this.offlineThreshold}): ${result.error}`,
        );
      }
    }
  }

  private async probeEndpoint(
    baseUrl: string,
    expectedModel: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const modelsUrl = baseUrl.replace(/\/v1$/, '') + '/v1/models';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const models: string[] = data.data?.map((m: { id: string }) => m.id) ?? [];

      const modelMatch = models.some(
        (id) =>
          id === expectedModel ||
          id.includes(expectedModel) ||
          expectedModel.includes(id),
      );

      if (!modelMatch && models.length > 0) {
        return {
          ok: false,
          error: `Model mismatch: expected "${expectedModel}", got ${models.join(', ')}`,
        };
      }

      return { ok: true };
    } catch (err) {
      clearTimeout(timeout);
      const error = err as Error;
      if (error.name === 'AbortError') {
        return { ok: false, error: `Timeout after ${timeoutMs}ms` };
      }
      return { ok: false, error: error.message };
    }
  }
}