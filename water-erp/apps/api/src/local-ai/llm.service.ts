import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as https from 'https';
import { ConfigService } from '@nestjs/config';

/**
 * LlmService（DeepSeek-only 精简版）—— 全系统 LLM 调用唯一入口
 *
 * 移植自 procurement apps/api/src/local-ai/llm.service.ts，按 v4.1 方案 8.1 精简；
 * 2026-07 生产加固：
 *  - 收口全部直连 fetch 调用点（announcement-ai / supplier-selection-ai / ai.service.dashboardSummary / assistant DeepSeekProvider）
 *  - 新增 `LlmCallOptions`（model/maxTokens/timeoutMs/retries）—— 位置签名向后兼容
 *  - 新增 `chatMessages()` 多轮对话 API（assistant 用）
 *  - 429/5xx/网络/超时自动重试（LLM_MAX_RETRIES，指数退避，遵守 Retry-After≤8s）；调用方 abort 与 JSON 解析失败不重试
 *  - 进程内并发信号量（LLM_MAX_CONCURRENCY）：突发并发排队而非打爆上游配额
 */

interface DeepSeekConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LlmCallOptions {
  /** 本次调用模型覆盖（默认 env DEEPSEEK_MODEL）——供 flash/chat 等不同档位的调用点使用 */
  model?: string;
  /** 默认 chat/chatJson 16384、chatMessages 8192 */
  maxTokens?: number;
  /** 默认 180_000 ms */
  timeoutMs?: number;
  /** 覆盖 env LLM_MAX_RETRIES（如 0：延迟敏感的调用放弃重试） */
  retries?: number;
}

/** HTTP 失败：429/5xx 可重试，携带 Retry-After（毫秒，已解析） */
export class LlmHttpError extends ServiceUnavailableException {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(status: number, body: string, retryAfterMs?: number) {
    super(
      `DeepSeek LLM request failed: ${status} ${body.slice(0, 200)}`,
    );
    this.retryable = status === 429 || status >= 500;
    this.retryAfterMs = retryAfterMs;
  }
}

function intEnv(
  config: ConfigService,
  name: string,
  fallback: number,
  min = 0,
): number {
  const v = Number(config.get<string>(name));
  return Number.isInteger(v) && v >= min ? v : fallback;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

/** FIFO 并发信号量：abort 感知、出错必释放 */
export class LlmSemaphore {
  private active = 0;
  private warnedHighWater = false;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: unknown) => void;
  }> = [];

  constructor(
    private readonly max: number,
    private readonly onHighWater?: () => void,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    if (this.queue.length > 20 && !this.warnedHighWater) {
      this.warnedHighWater = true;
      this.onHighWater?.();
    }
    return new Promise<() => void>((resolve, reject) => {
      const item = { resolve, reject };
      this.queue.push(item);
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.queue.indexOf(item);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(signal.reason ?? new Error('aborted while queued'));
          }
        },
        { once: true },
      );
    });
  }

  private makeRelease(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) next.resolve(this.makeRelease());
      else this.active--;
    };
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly deepseek: DeepSeekConfig | null;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly retryAfterCapMs = 8_000;
  private readonly semaphore: LlmSemaphore;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('DEEPSEEK_API_KEY');
    const rawBaseUrl = apiKey
      ? config.get<string>(
          'DEEPSEEK_BASE_URL',
          config.get<string>('DEEPSEEK_API_URL', 'https://api.deepseek.com'),
        )
      : '';
    this.deepseek = apiKey
      ? {
          // 规范化：去尾斜杠与 /v1，统一 `${baseUrl}/chat/completions`（DeepSeek 两种约定都兼容）
          baseUrl: rawBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, ''),
          // ★ v4.1：原 procurement 硬编码 'deepseek-v4-pro'，改为 env 驱动（.env DEEPSEEK_MODEL）
          model: config.get<string>('DEEPSEEK_MODEL', 'deepseek-v4-pro'),
          apiKey,
        }
      : null;
    this.maxRetries = intEnv(config, 'LLM_MAX_RETRIES', 2);
    this.retryBaseMs = Math.max(1, intEnv(config, 'LLM_RETRY_BASE_MS', 500, 1));
    this.semaphore = new LlmSemaphore(
      Math.max(1, intEnv(config, 'LLM_MAX_CONCURRENCY', 10, 1)),
      () =>
        this.logger.warn(
          `LLM 并发排队超过 20（LLM_MAX_CONCURRENCY=${Math.max(
            1,
            intEnv(config, 'LLM_MAX_CONCURRENCY', 10, 1),
          )}）——上游可能过载或配额不足`,
        ),
    );
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
    options?: LlmCallOptions,
  ): Promise<string> {
    this.getPrimary();
    const r = await this.withRetry(
      () =>
        this.requestOnce({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          maxTokens: options?.maxTokens ?? 16384,
          timeoutMs: options?.timeoutMs ?? 180_000,
          model: options?.model,
          seed,
          signal,
        }),
      options,
      signal,
    );
    return r.content;
  }

  async chatJson<T>(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0,
    signal?: AbortSignal,
    seed?: number,
    options?: LlmCallOptions,
  ): Promise<T> {
    this.getPrimary();
    // DeepSeek 官方 JSON mode（api-docs.deepseek.com/guides/json_mode）：
    //  - response_format {'type':'json_object'} + prompt 含 "json" 词 + 格式示例
    //  - 明示禁止 Markdown 代码围栏（v4 系模型偶发包裹围栏/空内容，官方已知问题）
    //  - 空 content / finish_reason=length 截断 → 抛 retryable 错误走 withRetry 重试
    const content = await this.withRetry(
      () =>
        this.requestOnce({
          messages: [
            {
              role: 'system',
              content:
                systemPrompt +
                '\n\n请以 JSON 格式输出。Return only valid JSON, no Markdown fences, no extra text.',
            },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          maxTokens: options?.maxTokens ?? 16384,
          timeoutMs: options?.timeoutMs ?? 180_000,
          model: options?.model,
          seed,
          signal,
          responseFormat: { type: 'json_object' },
        }).then((r) => {
          // 官方已知问题：JSON 输出偶发空 content → 可重试
          if (!r.content.trim()) {
            const e = new ServiceUnavailableException(
              'LLM 返回空内容（DeepSeek JSON mode 已知问题），将重试',
            ) as ServiceUnavailableException & { retryable: boolean };
            e.retryable = true;
            throw e;
          }
          // 截断检测：finish_reason=length → JSON 必不完整，重试
          if (r.finishReason === 'length') {
            const e = new ServiceUnavailableException(
              'LLM 输出被截断（finish_reason=length），将重试',
            ) as ServiceUnavailableException & { retryable: boolean };
            e.retryable = true;
            throw e;
          }
          return r.content;
        }),
      options,
      signal,
    );
    return this.parseJson<T>(content);
  }

  /** 多轮对话（assistant 等需要完整 messages 历史的场景） */
  async chatMessages(
    messages: ChatMessage[],
    options?: LlmCallOptions & {
      temperature?: number;
      signal?: AbortSignal;
      seed?: number;
    },
  ): Promise<string> {
    this.getPrimary();
    const r = await this.withRetry(
      () =>
        this.requestOnce({
          messages,
          temperature: options?.temperature ?? 0.7,
          maxTokens: options?.maxTokens ?? 8192,
          timeoutMs: options?.timeoutMs ?? 180_000,
          model: options?.model,
          seed: options?.seed,
          signal: options?.signal,
        }),
      options,
      options?.signal,
    );
    return r.content;
  }

  /** 重试外壳：仅 retryable 错误重试；调用方 abort 立即放弃 */
  private async withRetry<T>(
    fn: () => Promise<T>,
    options: LlmCallOptions | undefined,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const retries = options?.retries ?? this.maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await this.semaphore.run(fn, callerSignal);
      } catch (err) {
        const retryable = (err as { retryable?: boolean })?.retryable === true;
        if (!retryable || attempt >= retries || callerSignal?.aborted) {
          throw err;
        }
        attempt++;
        const delay = this.retryDelay(err, attempt);
        this.logger.warn(
          `LLM 第 ${attempt}/${retries + 1} 次尝试失败（${String(
            (err as Error)?.message,
          ).slice(0, 120)}），${Math.round(delay)}ms 后重试`,
        );
        await sleep(delay, callerSignal);
      }
    }
  }

  private retryDelay(err: unknown, attempt: number): number {
    const retryAfter = (err as LlmHttpError)?.retryAfterMs;
    if (retryAfter != null) {
      return Math.min(retryAfter, this.retryAfterCapMs);
    }
    // 指数退避 500/1000/2000ms + 抖动
    return this.retryBaseMs * 2 ** (attempt - 1) + Math.random() * this.retryBaseMs;
  }

  /** 使用 Node 原生 https 模块直连（绕过 undici IPv6 超时问题） */
  private deepseekRequest(
    baseUrl: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    status: number;
    content: string;
    reasoningContent: string;
    finishReason: string | null;
    errorText: string;
    retryAfter: string | null;
  }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${baseUrl}/chat/completions`);
      const payload = JSON.stringify(body);
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        family: 4, // 强制 IPv4，绕过 undici/IPv6 DNS 超时
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 0, // 由外部 AbortController 控制超时
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          let content = '';
          let reasoningContent = '';
          let finishReason: string | null = null;
          try {
            const parsed = JSON.parse(data);
            const msg = parsed.choices?.[0]?.message;
            content = msg?.content ?? '';
            reasoningContent = msg?.reasoning_content ?? '';
            finishReason = parsed.choices?.[0]?.finish_reason ?? null;
          } catch {
            // 非 JSON 响应体：content 留空，由上层按错误处理
          }
          resolve({
            ok: res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? 0,
            content,
            reasoningContent,
            finishReason,
            errorText: data,
            retryAfter: res.headers['retry-after'] ?? null,
          });
        });
      });
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET' && signal?.aborted) return;
        reject(err);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (signal) {
        // abort 后必须 settle 本 Promise：仅 destroy() 会触发 ECONNRESET，被下方 error
        // 处理分支静默吞掉（signal.aborted 时 return），timeout/调用方取消两条路径将永久挂起
        const abortError = () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          return e;
        };
        signal.addEventListener('abort', () => { req.destroy(); reject(abortError()); }, { once: true });
        if (signal.aborted) { req.destroy(); reject(abortError()); return; }
      }
      req.write(payload);
      req.end();
    });
  }

  /** 单次 HTTP 请求（无重试）；超时/网络错误标记 retryable，调用方 abort 原样上抛 */
  private async requestOnce(p: {
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    model?: string;
    seed?: number;
    signal?: AbortSignal;
    responseFormat?: { type: 'json_object' };
  }): Promise<{ content: string; finishReason: string | null }> {
    const provider = this.getPrimary();
    // 调用方已取消：快速失败，不发起请求
    if (p.signal?.aborted) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, p.timeoutMs);
    const onCallerAbort = () => controller.abort();
    p.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await this.deepseekRequest(provider.baseUrl, provider.apiKey, {
        model: p.model ?? provider.model,
        temperature: p.temperature,
        max_tokens: p.maxTokens,
        ...(p.responseFormat ? { response_format: p.responseFormat } : {}),
        ...(p.seed != null ? { seed: p.seed } : {}),
        messages: p.messages,
      }, controller.signal);

      if (!response.ok) {
        throw new LlmHttpError(
          response.status,
          response.errorText,
          response.status === 429 || response.status >= 500
            ? parseRetryAfter(response.retryAfter)
            : undefined,
        );
      }

      // 思考模式兜底：content 为空但 reasoning_content 有内容时取后者（官方文档：
      // 思考模式下仅读 message.content；偶发空 content 属已知问题）
      if (!response.content.trim() && response.reasoningContent.trim()) {
        this.logger.warn(
          'LLM message.content 为空，回退使用 reasoning_content（思考模式）',
        );
        return { content: response.reasoningContent, finishReason: response.finishReason };
      }

      return { content: response.content, finishReason: response.finishReason };
    } catch (err) {
      if (err instanceof LlmHttpError) throw err;
      // 调用方主动取消：原样上抛（不重试）
      if (p.signal?.aborted) throw err;
      if (timedOut || (err as Error)?.name === 'AbortError') {
        const e = new ServiceUnavailableException(
          `DeepSeek LLM request timed out after ${p.timeoutMs}ms`,
        ) as ServiceUnavailableException & { retryable: boolean };
        e.retryable = true;
        throw e;
      }
      // 网络层失败（fetch failed 等）
      const e = new ServiceUnavailableException(
        `DeepSeek LLM network error: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
      ) as ServiceUnavailableException & { retryable: boolean };
      e.retryable = true;
      throw e;
    } finally {
      clearTimeout(timeout);
      p.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private parseJson<T>(content: string): T {
    let cleaned = content.trim();
    // 围栏剥离：容忍模型在任意位置包裹 ```json ... ``` 或 ``` ... ```
    cleaned = cleaned.replace(/```(?:json)?/g, '`').replace(/`/g, '').trim();
    if (!cleaned) {
      this.logger.warn('JSON parse failed: content is empty');
      throw new ServiceUnavailableException(
        'LLM 返回内容为空，无法解析为 JSON，请重试或检查模型配置',
      );
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // 兜底：截取首 '{' 到末 '}'（容忍前后夹杂说明文字）
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const slice = cleaned.slice(start, end + 1);
        try {
          this.logger.warn('JSON 解析失败后按首{尾}截取成功（模型输出夹杂额外文本）');
          return JSON.parse(slice) as T;
        } catch {
          /* 继续走统一报错 */
        }
      }
      this.logger.warn(
        `JSON parse failed, raw content (first 500): ${cleaned.slice(0, 500)}`,
      );
      this.logger.error(
        `JSON parse failed for content: ${cleaned.slice(0, 200)}...`,
      );
      throw new ServiceUnavailableException(
        'LLM 返回内容无法解析为 JSON 格式，请重试或检查模型配置',
      );
    }
  }
}
