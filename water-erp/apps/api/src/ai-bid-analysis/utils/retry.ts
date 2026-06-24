// apps/api/src/ai-bid-analysis/utils/retry.ts
import { Logger } from '@nestjs/common';

const logger = new Logger('RetryUtil');

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  retryOn?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = true,
    retryOn = () => true,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        logger.error(`All ${maxAttempts} attempts failed: ${lastError.message}`);
        throw lastError;
      }

      if (!retryOn(lastError)) {
        throw lastError;
      }

      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
      logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRetryableError(error: Error): boolean {
  // 网络错误、超时、服务暂时不可用等可重试
  const retryableMessages = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'timeout',
    'rate limit',
    'too many requests',
    'service unavailable',
    'internal server error',
  ];

  const message = error.message.toLowerCase();
  return retryableMessages.some(msg => message.includes(msg.toLowerCase()));
}
