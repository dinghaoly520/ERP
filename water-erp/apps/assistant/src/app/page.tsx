'use client';

import { useState, useCallback, useEffect } from 'react';
import { AssistantHome } from '@/components/assistant-home';
import { ChatWorkspace } from '@/components/chat-workspace';
import { HistorySidebar, type ConversationItem } from '@/components/history-sidebar';
import { api } from '@/lib/api';
import type { Message, ChatResponse } from '@/lib/types';
import { toast } from 'sonner';

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [inChat, setInChat] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [dataMode, setDataMode] = useState(false);

  // Fetch conversation list
  const refreshConversations = useCallback(async () => {
    try {
      const list = await api.get<ConversationItem[]>('/assistant/conversations');
      setConversations(list);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setDataMode((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSend = useCallback(
    async (msg: string) => {
      setDataMode(false);
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
        refreshConversations();
      } catch (e) {
        const errorMsg =
          e instanceof Error ? e.message : '请求失败，请稍后重试';
        toast.error(errorMsg);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, refreshConversations],
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

  const handleBack = useCallback(() => {
    setInChat(false);
    setMessages([]);
    setConversationId(undefined);
  }, []);

  const handleSelectConversation = useCallback(async (id: string) => {
    setDataMode(false);
    try {
      const res = await api.get<{
        messages: Array<{
          role: string;
          content: string;
          cardsJson?: unknown;
          citationsJson?: unknown;
          createdAt: string;
        }>;
      }>(`/assistant/conversations/${id}`);
      const msgs: Message[] = (res.messages || []).map((m) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        cards: (m as any).cardsJson || undefined,
        citations: (m as any).citationsJson || undefined,
        timestamp: new Date(m.createdAt).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));
      setMessages(msgs);
      setConversationId(id);
      setInChat(true);
    } catch {
      toast.error('加载对话失败，请重试');
    }
  }, []);

  const handleNew = useCallback(() => {
    setInChat(false);
    setMessages([]);
    setConversationId(undefined);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/assistant/conversations/${id}`);
      refreshConversations();
      if (id === conversationId) {
        handleNew();
      }
    } catch {
      toast.error('删除失败，请重试');
    }
  }, [conversationId, refreshConversations, handleNew]);

  return (
    <>
      <HistorySidebar
        conversations={conversations}
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNew}
        onBack={inChat ? handleBack : undefined}
        onDelete={handleDelete}
        collapsed={sidebarCollapsed}
        onToggleCollapse={setSidebarCollapsed}
      />
      <div style={{ paddingLeft: '40px' }}>
        {!inChat ? (
          <AssistantHome onSend={handleSend} isLoading={isLoading} />
        ) : (
          <ChatWorkspace
            messages={messages}
            onSend={handleSend}
            isLoading={isLoading}
            onConfirmAction={handleConfirmAction}
            onCancelAction={handleCancelAction}
            onBack={handleBack}
            headerLeft={sidebarCollapsed ? 40 : 260}
            dataMode={dataMode}
            onDataModeChange={setDataMode}
          />
        )}
      </div>
    </>
  );
}
