'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { AssistantHome } from '@/components/assistant-home';
import { ChatWorkspace } from '@/components/chat-workspace';
import { HistorySidebar, type ConversationItem } from '@/components/history-sidebar';
import { api, ApiError } from '@/lib/api';
import { useChatRequest } from '@/lib/use-chat-request';
import type { Message, ChatResponse } from '@/lib/types';
import { toast } from 'sonner';

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [inChat, setInChat] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [dataMode, setDataMode] = useState(false);

  // Track whether the next onSuccess call is a retry response
  const isRetryRef = useRef(false);

  // Track the last user message ID so the retry toast can match
  const lastUserMsgIdRef = useRef<string | null>(null);

  // ---- Conversation list ----

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

  // ---- Keyboard shortcut ----

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

  // ---- Chat request ----

  // onSuccess: create user + assistant messages from the API response.
  // Uses refs for conversationId to keep the callback stable.
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const handleOnSuccess = useCallback(
    (res: ChatResponse) => {
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

      isRetryRef.current = false;
      refreshConversations();
    },
    [refreshConversations],
  );

  const { send, cancel, isLoading, error, clearError, retry } = useChatRequest({
    onSuccess: handleOnSuccess,
  });

  // Show error toast with retry button when an error occurs
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!error) return;

    const isTimeout = error.code === 'TIMEOUT';
    const isNetwork = error.code === 'NETWORK_ERROR';

    toast.error(error.message, {
      description: isTimeout
        ? 'AI 生成耗时较长，可等待几秒后重试'
        : isNetwork
          ? '网络连接异常，正在自动重试...'
          : '请稍后重试',
      action: {
        label: '重试',
        onClick: () => {
          toast.dismiss();
          retryRef.current();
        },
      },
      duration: isNetwork ? 6000 : 15000,
    });
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- User actions ----

  const handleSend = useCallback(
    (msg: string) => {
      setDataMode(false);
      setInChat(true);

      // 立即添加用户消息到对话区，不要等到 API 返回
      isRetryRef.current = false;
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: msg,
        timestamp: new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      lastUserMsgIdRef.current = userMsg.id;
      setMessages((prev) => [...prev, userMsg]);

      send(msg, conversationIdRef.current);
    },
    [send],
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
    cancel();
    clearError();
    setInChat(false);
    setMessages([]);
    setConversationId(undefined);
    isRetryRef.current = false;
    lastUserMsgIdRef.current = null;
  }, [cancel, clearError]);

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
    cancel();
    clearError();
    setInChat(false);
    setMessages([]);
    setConversationId(undefined);
    isRetryRef.current = false;
    lastUserMsgIdRef.current = null;
  }, [cancel, clearError]);

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

  // Cancel in-flight request on unmount
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  // ---- Render ----

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
