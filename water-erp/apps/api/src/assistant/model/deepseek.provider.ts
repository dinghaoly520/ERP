import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import {
  AssistantModelProvider,
  ChatMessage,
  ModelResponse,
} from './assistant-model-provider';

/**
 * 水叮当助手的模型适配器 —— 2026-07 生产加固后为 LlmService 的薄壳：
 * 多轮 messages 经 llm.chatMessages()，超时/重试/并发限流由网关统一负责。
 * 抛错语义与文案保持不变（AssistantService 依赖具体错误信息）。
 */
@Injectable()
export class DeepSeekProvider extends AssistantModelProvider {
  private readonly logger = new Logger(DeepSeekProvider.name);

  constructor(private readonly llm: LlmService) {
    super();
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<ModelResponse> {
    if (!this.llm.getModel()) {
      throw new Error('DeepSeek API Key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
    }

    try {
      const text = await this.llm.chatMessages(messages, {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 8192,
        // assistant 历史默认 deepseek-chat（与其他调用点的 flash/pro 档不同）
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        timeoutMs: 60_000,
      });

      if (!text || !text.trim()) {
        throw new Error(
          'DeepSeek 返回了空内容，可能是内容安全过滤或模型异常，请稍后重试',
        );
      }
      return { text };
    } catch (e) {
      const name = (e as Error)?.name;
      const msg = (e as Error)?.message ?? '';
      // LlmService 超时（内部/重试耗尽）→ 保持原文案
      if (name === 'AbortError' || /timed out/i.test(msg)) {
        throw new Error('AI 请求超时，请稍后重试');
      }
      throw e;
    }
  }
}
