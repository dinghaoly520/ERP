'use client';

import { useState, useRef, useCallback } from 'react';
import { api, ApiError } from './api';
import type { ChatResponse } from './types';

interface UseChatRequestOptions {
  /** Called with the parsed ChatResponse on success */
  onSuccess: (res: ChatResponse) => void;
  /** Called on error — hook only updates state, caller decides how to present */
  onError?: (error: ApiError) => void;
}

interface UseChatRequest {
  /** 发送聊天请求，自动去重 */
  send: (message: string, conversationId?: string) => void;
  /** 取消正在进行的请求 */
  cancel: () => void;
  /** 是否有请求在进行中 */
  isLoading: boolean;
  /** 最近一次失败（null = 正常），watch 此值展示重试 UI */
  error: ApiError | null;
  /** 手动清除错误状态 */
  clearError: () => void;
  /** 用上次的消息和会话 ID 重新发送 */
  retry: () => void;
}

export function useChatRequest(opts: UseChatRequestOptions): UseChatRequest {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Keep callbacks stable via refs to avoid re-creating send/retry
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Track the in-flight AbortController for cancellation
  const abortRef = useRef<AbortController | null>(null);

  // Store the most recent (message, conversationId) for retry
  const lastMsgRef = useRef<{ message: string; conversationId?: string } | null>(null);

  // Prevent duplicate concurrent send() calls
  const sendingRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    sendingRef.current = false;
    setIsLoading(false);
  }, []);

  const send = useCallback(
    (message: string, conversationId?: string) => {
      // Dedup: ignore if already sending
      if (sendingRef.current) return;

      // Store for retry
      lastMsgRef.current = { message, conversationId };

      sendingRef.current = true;
      setError(null);
      setIsLoading(true);

      // Cancel any lingering request (safety net)
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      api
        .post<ChatResponse>(
          '/assistant/chat',
          { conversationId, message },
          { signal: controller.signal, timeout: 90_000, retries: 2 },
        )
        .then((res) => {
          abortRef.current = null;
          sendingRef.current = false;
          setIsLoading(false);
          optsRef.current.onSuccess(res);
        })
        .catch((e: unknown) => {
          abortRef.current = null;
          sendingRef.current = false;
          setIsLoading(false);

          // Ignore user-cancelled requests
          if (e instanceof ApiError && e.code === 'CANCELLED') return;

          const apiError =
            e instanceof ApiError
              ? e
              : new ApiError(0, 'NETWORK_ERROR', `网络请求失败: ${String(e)}`);

          setError(apiError);
          optsRef.current.onError?.(apiError);
        });
    },
    [], // Stable — opts via ref, all other deps are stable callbacks/refs
  );

  const retry = useCallback(() => {
    const last = lastMsgRef.current;
    if (!last) return;
    setError(null);
    send(last.message, last.conversationId);
  }, [send]);

  return { send, cancel, isLoading, error, clearError, retry };
}
