import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  type: 'deepseek' | 'local';
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly deepseek: LlmConfig | null;
  private readonly local: LlmConfig | null;

  constructor(private config: ConfigService) {
    const apiKey = config.get<string>('DEEPSEEK_API_KEY');
    this.deepseek = apiKey
      ? {
          baseUrl: config.get<string>(
            'DEEPSEEK_BASE_URL',
            'https://api.deepseek.com',
          ),
          // 招标文件审查使用 pro 模型以获得更深入的分析质量
          model: 'deepseek-v4-pro',
          apiKey,
          type: 'deepseek',
        }
      : null;

    const localUrl = config.get<string>('LLM_BASE_URL');
    this.local = localUrl
      ? {
          baseUrl: localUrl,
          model: config.get<string>('LLM_MODEL', 'qwen3.6-35b'),
          apiKey: config.get<string>('LLM_API_KEY', 'token-abc123'),
          type: 'local',
        }
      : null;
  }

  private getPrimary(): LlmConfig {
    if (this.deepseek) return this.deepseek;
    if (this.local) return this.local;
    throw new ServiceUnavailableException(
      'No LLM provider configured. Set DEEPSEEK_API_KEY or LLM_BASE_URL.',
    );
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.3,
    signal?: AbortSignal,
  ): Promise<string> {
    const provider = this.getPrimary();
    try {
      return await this.callChat(
        provider,
        systemPrompt,
        userPrompt,
        temperature,
        signal,
      );
    } catch (err) {
      const fallback =
        provider.type === 'deepseek' ? this.local : this.deepseek;
      if (!fallback) throw err;
      this.logger.warn(
        `${provider.type} LLM failed, falling back to ${fallback.type}: ${(err as Error).message}`,
      );
      return await this.callChat(
        fallback,
        systemPrompt,
        userPrompt,
        temperature,
        signal,
      );
    }
  }

  private async callChat(
    provider: LlmConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    const isLocal = provider.type === 'local';

    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...(isLocal
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `${provider.type} LLM request failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  async chatJson<T>(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const provider = this.getPrimary();

    if (provider.type === 'deepseek') {
      return this.deepseekChatJson<T>(
        provider,
        systemPrompt,
        userPrompt,
        signal,
      );
    }

    const content = await this.chat(
      systemPrompt + '\n\n请以 JSON 格式输出，不要包含 markdown 代码块标记。',
      userPrompt,
      0.1,
      signal,
    );
    return this.parseJson(content);
  }

  private async deepseekChatJson<T>(
    provider: LlmConfig,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
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
          temperature: 0.1,
          response_format: { type: 'json_object' },
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
      if (this.local) {
        this.logger.warn(
          `DeepSeek JSON call failed, falling back to local: ${response.status}`,
        );
        const content = await this.callChat(
          this.local,
          systemPrompt +
            '\n\n请以 JSON 格式输出，不要包含 markdown 代码块标记。',
          userPrompt,
          0.1,
          signal,
        );
        return this.parseJson(content);
      }
      throw new ServiceUnavailableException(
        `DeepSeek LLM request failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    return this.parseJson(content);
  }

  private parseJson<T>(content: string): T {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
      cleaned = cleaned.replace(/\n?```\s*$/, '');
      cleaned = cleaned.trim();
    }
    return JSON.parse(cleaned) as T;
  }
}
