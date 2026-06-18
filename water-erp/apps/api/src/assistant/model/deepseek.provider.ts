import { Injectable } from '@nestjs/common';
import {
  AssistantModelProvider,
  ChatMessage,
  ModelResponse,
} from './assistant-model-provider';

@Injectable()
export class DeepSeekProvider extends AssistantModelProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    super();
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
    this.baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }

  async chat(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API Key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 8192,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.error?.message || `DeepSeek API 返回错误 (${res.status})`,
        );
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error(
          'DeepSeek 返回了空内容，可能是内容安全过滤或模型异常，请稍后重试',
        );
      }
      return { text: content };
    } catch (e) {
      clearTimeout(timeoutId);
      if ((e as Error).name === 'AbortError') {
        throw new Error('AI 请求超时，请稍后重试');
      }
      throw e;
    }
  }
}
