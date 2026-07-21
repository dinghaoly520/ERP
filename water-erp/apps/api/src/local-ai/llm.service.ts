import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * LlmService（DeepSeek-only 精简版）
 *
 * 移植自 procurement apps/api/src/local-ai/llm.service.ts，按 v4.1 方案 8.1 精简：
 *  - 剥离 local / vLLM provider（ERP 无 vLLM 基建）
 *  - 剥离 VllmMonitorService / EmbeddingService 强依赖（原 forwardRef 注入会致 DI 启动即崩）
 *  - 原 llm.service.ts:37 硬编码 model:'deepseek-v4-pro' → 改 config.get('DEEPSEEK_MODEL') env 驱动
 */
interface DeepSeekConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly deepseek: DeepSeekConfig | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('DEEPSEEK_API_KEY');
    this.deepseek = apiKey
      ? {
          baseUrl: config.get<string>(
            'DEEPSEEK_BASE_URL',
            config.get<string>('DEEPSEEK_API_URL', 'https://api.deepseek.com'),
          ),
          // ★ v4.1：原 procurement 硬编码 'deepseek-v4-pro'，改为 env 驱动（.env DEEPSEEK_MODEL）
          model: config.get<string>('DEEPSEEK_MODEL', 'deepseek-v4-pro'),
          apiKey,
        }
      : null;
  }

  private getPrimary(): DeepSeekConfig {
    if (!this.deepseek) {
      throw new ServiceUnavailableException(
        'DeepSeek LLM not configured. Set DEEPSEEK_API_KEY in .env',
      );
    }
    return this.deepseek;
  }

  /** P0-D：暴露当前模型名（供 aiProvenance 快照；未配置返回 null，不抛错） */
  getModel(): string | null {
    return this.deepseek?.model ?? null;
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.3,
    signal?: AbortSignal,
    seed?: number,
  ): Promise<string> {
    const provider = this.getPrimary();
    return this.callChat(
      provider,
      systemPrompt,
      userPrompt,
      temperature,
      signal,
      seed,
    );
  }

  async chatJson<T>(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0,
    signal?: AbortSignal,
    seed?: number,
  ): Promise<T> {
    const provider = this.getPrimary();
    // DeepSeek 支持 response_format 强制 JSON
    return this.deepseekChatJson<T>(
      provider,
      systemPrompt,
      userPrompt,
      temperature,
      signal,
      seed,
    );
  }

  private async callChat(
    provider: DeepSeekConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    signal?: AbortSignal,
    seed?: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          temperature,
          max_tokens: 8192,
          ...(seed != null ? { seed } : {}),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `DeepSeek LLM request failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async deepseekChatJson<T>(
    provider: DeepSeekConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    signal?: AbortSignal,
    seed?: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          temperature,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
          ...(seed != null ? { seed } : {}),
          messages: [
            {
              role: 'system',
              content: systemPrompt + '\n\n请以 JSON 格式输出。',
            },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `DeepSeek LLM request failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    return this.parseJson<T>(content);
  }

  private parseJson<T>(content: string): T {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
      cleaned = cleaned.replace(/\n?```\s*$/, '');
      cleaned = cleaned.trim();
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      this.logger.error(
        `JSON parse failed for content: ${cleaned.slice(0, 200)}...`,
      );
      throw new ServiceUnavailableException(
        'LLM 返回内容无法解析为 JSON 格式，请重试或检查模型配置',
      );
    }
  }
}
