"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Minimize2, Maximize2, X } from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { Message } from "./types";
import { MiniSprite } from "./mini-sprite";

// ---- 规则兜底追问 ----

function getFallbackFollowUps(content: string, actions?: Array<{ type: string }>): string[] {
  const hasChart = actions?.some((a) => a.type === "chart");
  const hasNavigate = actions?.some((a) => a.type === "navigate");
  if (hasNavigate) return ["好的，带我过去"];
  if (hasChart) return ["帮我导出这些数据", "能详细分析一下第一项吗？"];
  const hasNumbers = /\d+[\d,.]*\s*(万|亿|元|个|项|%|人)/.test(content);
  if (hasNumbers) return ["帮我生成图表", "这些数据有变化趋势吗？"];
  return content.length > 200
    ? ["能再详细一点吗？", "还有哪些相关的信息？"]
    : ["能展开说说吗？"];
}

function extractSuggestions(actions?: Array<{ type: string; items?: string[] }>): string[] | undefined {
  const s = actions?.find((a) => a.type === "suggestions");
  return s?.items;
}

// ---- 共享工具 ----

function MessageList({
  displayMessages,
  isEmpty,
  isMini,
  isStreaming,
  streamingContent,
  userName,
  expression,
  lastBotMsg,
  lastBotActions,
  onSend,
}: {
  displayMessages: Message[];
  isEmpty: boolean;
  isMini: boolean;
  isStreaming: boolean;
  streamingContent: string;
  userName: string;
  expression: string;
  lastBotMsg: Message | undefined;
  lastBotActions: Array<{ type: string; items?: string[] }> | undefined;
  onSend: (t: string) => Promise<void>;
}) {
  const welcomeCls = isMini ? "asst-welcome" : "asst-page-welcome";
  const logoCls = isMini ? "asst-welcome-logo" : "asst-welcome-logo";
  const titleCls = isMini ? "asst-welcome-title asst-welcome-title-mini" : "asst-welcome-title";

  return (
    <>
      {isEmpty && (
        <div className={welcomeCls}>
          <div className="relative">
            <div className={logoCls}>
              <img src="/procurement-brand-logo.png" alt="智慧水发" className="w-full h-full object-contain" />
            </div>
            {!isMini && <div className="asst-welcome-glow" />}
          </div>
          <div>
            <div className={titleCls}>
              {userName && <div>{userName}，</div>}
              <div>你好呀，我是水叮当</div>
            </div>
          </div>
        </div>
      )}

      {displayMessages.map((msg) => {
        const isLastBot = msg === lastBotMsg && msg.role === "assistant";
        const llmSuggestions = isLastBot ? extractSuggestions(lastBotActions) : undefined;
        const fallbacks = isLastBot && !llmSuggestions && msg.content
          ? getFallbackFollowUps(msg.content, lastBotActions)
          : undefined;
        return (
          <ChatMessage
            key={msg.id}
            message={msg}
            followUps={llmSuggestions ?? fallbacks}
            onSendFollowUp={(text) => void onSend(text)}
          />
        );
      })}

      {isStreaming && !streamingContent && (
        <div className="asst-thinking-row">
          <MiniSprite size={28} expression="thinking" animated />
          <div className="asst-thinking-bubble">
            <span className="thinking-dots"><span /><span /><span /></span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">水叮当在想呢 🤔</span>
          </div>
        </div>
      )}
    </>
  );
}

// ---- 主组件 ----

type ChatPanelProps = { variant: "page" | "mini" };

export function ChatPanel({ variant }: ChatPanelProps) {
  const {
    chatState,
    isMiniOpen,
    expression,
    userName,
    openMini,
    closeMini,
    sendMessage,
    startNewConversation,
    selectConversation,
    removeConversation,
    loadConversations,
  } = useAssistant();

  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState.messages, chatState.streamingContent]);

  if (variant === "mini" && !isMiniOpen) return null;

  const { messages, isStreaming, streamingContent, streamingActions, activeConversationId, conversations } = chatState;

  const displayMessages = [...messages];
  if (isStreaming && streamingContent) {
    displayMessages.push({
      id: "streaming", conversationId: activeConversationId ?? "", role: "assistant" as const,
      content: streamingContent, toolCalls: null, toolResult: null,
      actions: streamingActions.length > 0 ? streamingActions : null,
      createdAt: new Date().toISOString(),
    });
  }

  const isEmpty = displayMessages.length === 0 && !isStreaming;
  const lastBotMsg = [...displayMessages].reverse().find((m) => m.role === "assistant");
  const lastBotActions = (lastBotMsg?.actions as Array<{ type: string; items?: string[] }> | undefined) ?? undefined;

  const isMini = variant === "mini";

  const handlePopToMini = () => { openMini(); router.back(); };
  const handleExpandFromMini = () => { router.push("/assistant"); };

  // ---- PAGE variant: borderless, naturally integrated ----
  if (!isMini) {
    return (
      <div className="asst-page">
        {/* Header — no bar, no divider */}
        <div className="asst-page-header">
          <MiniSprite size={32} expression={isStreaming ? "thinking" : expression} animated />
          <span className="asst-page-header-title">水叮当</span>
          {isStreaming && (
            <span className="asst-thinking-badge">
              <span className="asst-thinking-dot" />思考中
            </span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <button onClick={() => void startNewConversation()} title="新对话" className="asst-page-header-btn">
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1v12M1 7h12"/></svg>
            </button>
            <button onClick={handlePopToMini} title="收为小窗" className="asst-page-header-btn">
              <Minimize2 size={15} />
            </button>
          </div>
        </div>

        {/* Conversation tabs */}
        {conversations.length > 1 && (
          <div className="asst-page-tabs">
            {conversations.map((conv) => (
              <button key={conv.id} onClick={() => void selectConversation(conv.id)}
                className={`asst-conv-tab ${conv.id === activeConversationId ? "asst-conv-tab-active" : ""}`}>
                <span className="truncate max-w-[120px]">{conv.title}</span>
                <span onClick={(e) => { e.stopPropagation(); void removeConversation(conv.id); }} className="asst-conv-tab-delete">×</span>
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="asst-page-messages">
          <MessageList
            displayMessages={displayMessages} isEmpty={isEmpty} isMini={false}
            isStreaming={isStreaming} streamingContent={streamingContent}
            userName={userName} expression={expression}
            lastBotMsg={lastBotMsg} lastBotActions={lastBotActions} onSend={sendMessage}
          />
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {chatState.error && <div className="asst-error">{chatState.error}</div>}

        {/* Input — neumorphic centered pill */}
        <div className="asst-page-input-area">
          <div className="asst-page-input-row">
            <textarea
              id="asst-page-textarea"
              placeholder="问水叮当..."
              disabled={isStreaming}
              rows={1}
              className="asst-page-input"
              style={{ maxHeight: 100 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const val = el.value.trim();
                  if (val && !isStreaming) { void sendMessage(val); el.value = ""; el.style.height = "auto"; }
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
              }}
            />
            <button
              onClick={() => {
                const ta = document.getElementById("asst-page-textarea") as HTMLTextAreaElement | null;
                if (!ta) return;
                const val = ta.value.trim();
                if (val && !isStreaming) { void sendMessage(val); ta.value = ""; ta.style.height = "auto"; }
              }}
              disabled={isStreaming}
              className="asst-page-input-btn"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L14 2L10 14L8 9L2 8Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- MINI variant: keeps framed overlay look ----
  return (
    <div className="asst-mini">
      <div className="asst-panel-header">
        <MiniSprite size={30} expression={isStreaming ? "thinking" : expression} animated />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[color:var(--foreground)]">水叮当</span>
            {isStreaming && (
              <span className="asst-thinking-badge"><span className="asst-thinking-dot" />思考中</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => void startNewConversation()} title="新对话" className="asst-header-btn">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1v12M1 7h12"/></svg>
          </button>
          <button onClick={handleExpandFromMini} title="展开全屏" className="asst-header-btn"><Maximize2 size={14} /></button>
          <button onClick={closeMini} title="关闭小窗" className="asst-header-btn"><X size={14} /></button>
        </div>
      </div>

      {conversations.length > 1 && (
        <div className="asst-panel-tabs">
          {conversations.map((conv) => (
            <button key={conv.id} onClick={() => void selectConversation(conv.id)}
              className={`asst-conv-tab ${conv.id === activeConversationId ? "asst-conv-tab-active" : ""}`}>
              <span className="truncate max-w-[120px]">{conv.title}</span>
              <span onClick={(e) => { e.stopPropagation(); void removeConversation(conv.id); }} className="asst-conv-tab-delete">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="asst-messages asst-messages-mini">
        <MessageList
          displayMessages={displayMessages} isEmpty={isEmpty} isMini
          isStreaming={isStreaming} streamingContent={streamingContent}
          userName={userName} expression={expression}
          lastBotMsg={lastBotMsg} lastBotActions={lastBotActions} onSend={sendMessage}
        />
        <div ref={messagesEndRef} />
      </div>

      {chatState.error && <div className="asst-error">{chatState.error}</div>}

      <ChatInput onSend={(c) => void sendMessage(c)} disabled={isStreaming} />
    </div>
  );
}
