"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type {
  AssistantPageContext,
  AssistantAction,
  ChatState,
  Conversation,
  Message,
} from "./types";
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  sendMessage,
  generateTitle,
} from "@/lib/api/assistant";
import { type SpriteExpression, inferExpression } from "./sprite-images";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";

// ---- Context shape ----

type AssistantContextValue = {
  pageContext: AssistantPageContext;
  setPageContext: (ctx: Partial<AssistantPageContext>) => void;
  chatState: ChatState;
  isOpen: boolean;
  isExpanded: boolean;
  isMiniOpen: boolean;
  expression: SpriteExpression;
  userName: string;
  openChat: () => void;
  closeChat: () => void;
  openMini: () => void;
  closeMini: () => void;
  toggleExpand: () => void;
  sendMessage: (content: string) => Promise<void>;
  startNewConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}

// ---- Initial state ----

const initialChatState: ChatState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingActions: [],
  error: null,
};

// ---- Provider ----

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextRaw] = useState<AssistantPageContext>({
    currentPage: "",
    currentModule: "",
  });
  const [chatState, setChatState] = useState<ChatState>(initialChatState);
  const [isOpen, setIsOpen] = useState(false);
  const [isMiniOpen, setIsMiniOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expression, setExpression] = useState<SpriteExpression>("normal");
  const [userName, setUserName] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingRef = useRef<{ content: string; actions: Array<Record<string, unknown>> }>({ content: "", actions: [] });

  const setPageContext = useCallback(
    (partial: Partial<AssistantPageContext>) => {
      setPageContextRaw((prev) => ({ ...prev, ...partial }));
    },
    [],
  );

  const openChat = useCallback(() => {
    setIsOpen(true);
    // 加载用户信息（仅首次）
    if (!userName) {
      fetchCurrentUser()
        .then((u: AuthUser) => {
          setUserName(u.displayName || u.username || "");
          setPageContext({ userRole: u.role || "" });
        })
        .catch(() => {});
    }
  }, [userName]);
  const closeChat = useCallback(() => {
    setIsOpen(false);
    setIsExpanded(false);
  }, []);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const convs = await listConversations();
      setChatState((s) => ({ ...s, conversations: convs }));
    } catch {
      // silent
    }
  }, []);

  const openMini = useCallback(() => {
    setIsMiniOpen(true);
    // 加载用户名和对话列表（若尚未加载）
    if (!userName) {
      fetchCurrentUser()
        .then((u) => setUserName(u.displayName || u.username || ""))
        .catch(() => {});
    }
    void loadConversations();
  }, [userName, loadConversations]);
  const closeMini = useCallback(() => setIsMiniOpen(false), []);
  const toggleExpand = useCallback(() => setIsExpanded((v) => !v), []);

  // Select a conversation
  const selectConversation = useCallback(async (id: string) => {
    setChatState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const conv = await getConversation(id);
      setChatState((s) => ({
        ...s,
        activeConversationId: id,
        messages: conv.messages as Message[],
        isLoading: false,
      }));
    } catch {
      setChatState((s) => ({ ...s, isLoading: false, error: "加载对话失败" }));
    }
  }, []);

  // Start new conversation
  const startNewConversation = useCallback(async () => {
    try {
      const conv = await createConversation();
      setChatState((s) => ({
        ...s,
        activeConversationId: conv.id,
        messages: [],
        conversations: [conv, ...s.conversations],
        error: null,
      }));
    } catch {
      setChatState((s) => ({ ...s, error: "创建对话失败" }));
    }
  }, []);

  // Delete conversation
  const removeConversation = useCallback(
    async (id: string) => {
      try {
        // Find the next conversation ID before deleting (for switching)
        const currentConversations = chatState.conversations;
        const isDeletingActive = chatState.activeConversationId === id;
        const nextConversation = isDeletingActive
          ? currentConversations.find((c) => c.id !== id)
          : null;

        await deleteConversation(id);
        setChatState((s) => ({
          ...s,
          conversations: s.conversations.filter((c) => c.id !== id),
          activeConversationId: nextConversation
            ? nextConversation.id
            : s.activeConversationId === id
              ? null
              : s.activeConversationId,
          messages: s.activeConversationId === id ? [] : s.messages,
          error: null,
        }));

        // If deleted the active conversation, switch to the next one
        if (nextConversation) {
          await selectConversation(nextConversation.id);
        }
      } catch {
        // silent
      }
    },
    [chatState.activeConversationId, chatState.conversations, selectConversation],
  );

  // Send message with SSE streaming
  const sendMsg = useCallback(
    async (content: string) => {
      // Abort previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const convId = chatState.activeConversationId;

      // Auto-create conversation if none exists
      let activeConvId = convId;
      if (!activeConvId) {
        try {
          const conv = await createConversation();
          activeConvId = conv.id;
          setChatState((s) => ({
            ...s,
            activeConversationId: conv.id,
            conversations: [conv, ...s.conversations],
          }));
        } catch {
          setChatState((s) => ({ ...s, error: "创建对话失败" }));
          abortControllerRef.current = null;
          return;
        }
      }

      // Track if this is the first message (for auto-title)
      const isFirstMessage = chatState.messages.length === 0;

      // Add user message to UI immediately
      const tempUserMsg: Message = {
        id: `temp-${Date.now()}`,
        conversationId: activeConvId,
        role: "user",
        content,
        toolCalls: null,
        toolResult: null,
        actions: null,
        createdAt: new Date().toISOString(),
      };

      setExpression('thinking');
      streamingRef.current = { content: "", actions: [] };
      setChatState((s) => ({
        ...s,
        messages: [...s.messages, tempUserMsg],
        isStreaming: true,
        streamingContent: "",
        streamingActions: [],
        error: null,
      }));

      await sendMessage(activeConvId, content, pageContext, {
        onToken: (token) => {
          streamingRef.current.content = token;
          setChatState((s) => ({
            ...s,
            streamingContent: token,
          }));
        },
        onToolCall: () => {},
        onToolResult: () => {},
        onAction: (action) => {
          streamingRef.current.actions = [...streamingRef.current.actions, action];
          setChatState((s) => ({
            ...s,
            streamingActions: [...s.streamingActions, action],
          }));
        },
        onDone: (messageId) => {
          abortControllerRef.current = null;
          // 从 ref 捕获流式内容（setState 异步更新，chatState 可能还是旧值）
          const finalText = streamingRef.current.content;
          const finalActions = [...streamingRef.current.actions];
          setChatState((s) => {
            const assistantMsg: Message = {
              id: messageId || `msg-${Date.now()}`,
              conversationId: activeConvId,
              role: "assistant",
              content: finalText,
              toolCalls: null,
              toolResult: null,
              actions:
                finalActions.length > 0 ? finalActions : null,
              createdAt: new Date().toISOString(),
            };
            return {
              ...s,
              messages: [...s.messages, assistantMsg],
              isStreaming: false,
              streamingContent: "",
              streamingActions: [],
            };
          });

          // Auto-generate title for first message
          if (isFirstMessage) {
            console.log('[Assistant] Generating title for conversation:', activeConvId);
            generateTitle(activeConvId).then((title) => {
              console.log('[Assistant] Title generated:', title);
              setChatState((s) => ({
                ...s,
                conversations: s.conversations.map((c) =>
                  c.id === activeConvId ? { ...c, title } : c
                ),
              }));
            }).catch((err) => {
              console.error('[Assistant] Title generation failed:', err);
            });
          }

          // Set expression based on response
          const hasChart = finalActions.some((a: Record<string, unknown>) => a.type === 'chart');
          const hasKnowledge = /法规|合规|审查|风险|标准|流程|要求|必须|禁止/.test(finalText);
          if (hasChart) {
            setExpression('excited');
          } else if (hasKnowledge) {
            setExpression('serious');
          } else {
            setExpression('happy');
          }
          // Return to normal after a few seconds
          setTimeout(() => setExpression('normal'), 5000);
        },
        onError: (message) => {
          abortControllerRef.current = null;
          setExpression('pitiful');
          setTimeout(() => setExpression('normal'), 4000);
          setChatState((s) => ({
            ...s,
            isStreaming: false,
            error: message,
          }));
        },
      }, { signal });
    },
    [chatState.activeConversationId, chatState.messages.length, pageContext],
  );

  const value: AssistantContextValue = {
    pageContext,
    setPageContext,
    chatState,
    isOpen,
    isExpanded,
    isMiniOpen,
    expression,
    userName,
    openChat,
    closeChat,
    openMini,
    closeMini,
    toggleExpand,
    sendMessage: sendMsg,
    startNewConversation,
    selectConversation,
    removeConversation,
    loadConversations,
  };

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}
