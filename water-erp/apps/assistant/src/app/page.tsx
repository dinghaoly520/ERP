'use client';

import { useState, useCallback } from 'react';
import { AssistantHome } from '@/components/assistant-home';
import { ChatWorkspace } from '@/components/chat-workspace';
import { api } from '@/lib/api';
import type { Message, ChatResponse } from '@/lib/types';
import { toast } from 'sonner';

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [inChat, setInChat] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = useCallback(
    async (msg: string) => {
      setInChat(true);
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: msg,
        timestamp: new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const res = await api.post<ChatResponse>('/assistant/chat', {
          conversationId,
          message: msg,
        });
        setConversationId(res.conversationId);
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: res.answer,
          cards: res.cards,
          citations: res.citations,
          pendingActions: res.pendingActions,
          timestamp: new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        const errorMsg =
          e instanceof Error ? e.message : '请求失败，请稍后重试';
        toast.error(errorMsg);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId],
  );

  const handleConfirmAction = useCallback(async (actionId: string) => {
    try {
      const res = await api.post<{ status: string; message: string }>(
        `/assistant/actions/${actionId}/confirm`,
        { confirmed: true },
      );
      toast.success(res.message || '操作成功');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  }, []);

  const handleCancelAction = useCallback(async (actionId: string) => {
    try {
      const res = await api.post<{ status: string; message: string }>(
        `/assistant/actions/${actionId}/cancel`,
        {},
      );
      toast.success(res.message || '操作已取消');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消失败');
    }
  }, []);

  if (!inChat) {
    return <AssistantHome onSend={handleSend} isLoading={isLoading} />;
  }

  return (
    <ChatWorkspace
      messages={messages}
      onSend={handleSend}
      isLoading={isLoading}
      onConfirmAction={handleConfirmAction}
      onCancelAction={handleCancelAction}
    />
  );
}
