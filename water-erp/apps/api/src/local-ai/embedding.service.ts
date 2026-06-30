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

    const batchSize = 32;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
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
