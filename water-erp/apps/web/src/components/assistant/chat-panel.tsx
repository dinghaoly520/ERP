"use client";

import { useEffect, useRef } from "react";
import { useAssistant } from "./assistant-provider";
import { ChatMessage, FollowUpButtons } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { Message } from "./types";
import { MiniSprite } from "./mini-sprite";

// ---- 智能建议数据 ----


// 规则兜底追问 (LLM 未返回 suggestions 时)
function getFallbackFollowUps(content: string, actions?: Array<{ type: string }>): string[] {
  const hasChart = actions?.some((a) => a.type === "chart");
  const hasNavigate = actions?.some((a) => a.type === "navigate");

  if (hasNavigate) return ["好的，带我过去"];
  if (hasChart) return ["帮我导出这些数据", "能详细分析一下第一项吗？"];

  // 检测是否包含数据
  const hasNumbers = /\d+[\d,.]*\s*(万|亿|元|个|项|%|人)/.test(content);
  if (hasNumbers) return ["帮我生成图表", "这些数据有变化趋势吗？"];

  // 检测是否是知识解答
  const isExplanation = content.length > 200;
  if (isExplanation) return ["能再详细一点吗？", "还有哪些相关的信息？"];

  return ["能展开说说吗？"];
}

// 从 action 中提取 suggestions
function extractSuggestions(actions?: Array<{ type: string; items?: string[] }>): string[] | undefined {
  const s = actions?.find((a) => a.type === "suggestions");
  return s?.items;
}

// ---- 主组件 ----

export function ChatPanel() {
  const {
    chatState,
    isOpen,
    isExpanded,
    pageContext,
    expression,
    userName,
    closeChat,
    toggleExpand,
    sendMessage,
    startNewConversation,
    selectConversation,
    removeConversation,
    loadConversations,
  } = useAssistant();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) void loadConversations();
  }, [isOpen, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState.messages, chatState.streamingContent]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) closeChat();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, closeChat]);

  if (!isOpen) return null;

  const { messages, isStreaming, streamingContent, streamingActions, activeConversationId, conversations } = chatState;

  // Build display messages
  const displayMessages = [...messages];
  if (isStreaming && streamingContent) {
    displayMessages.push({
      id: "streaming",
      conversationId: activeConversationId ?? "",
      role: "assistant" as const,
      content: streamingContent,
      toolCalls: null,
      toolResult: null,
      actions: streamingActions.length > 0 ? streamingActions : null,
      createdAt: new Date().toISOString(),
    });
  }

  const isEmpty = displayMessages.length === 0 && !isStreaming;

  // 智能建议

  // 最后一条 bot 消息的追问
  const lastBotMsg = [...displayMessages].reverse().find((m) => m.role === "assistant");
  const lastBotActions = (lastBotMsg?.actions as Array<{ type: string; items?: string[] }> | undefined) ?? undefined;

  return (
    <div className={`asst-panel ${isExpanded ? "asst-panel-expanded" : "asst-panel-normal"}`}>
      {/* Header */}
      <div className="asst-panel-header">
        <MiniSprite size={38} expression={isStreaming ? "thinking" : expression} animated />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="asst-panel-header-title">水叮当</span>
            {isStreaming && (
              <span className="asst-thinking-badge">
                <span className="asst-thinking-dot" />
                思考中
              </span>
            )}
          </div>
          {/* 副标题已删除 */}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          <HeaderButton onClick={() => void startNewConversation()} title="新对话">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1v12M1 7h12" /></svg>
          </HeaderButton>
          <HeaderButton onClick={toggleExpand} title={isExpanded ? "缩小" : "放大"}>
            {isExpanded ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 1v3H1M4 4L1 1M10 1v3h3M10 4l3-3M4 13v-3H1M4 10l-3 3M10 13v-3h3M10 10l3 3" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" /></svg>
            )}
          </HeaderButton>
          <HeaderButton onClick={closeChat} title="关闭">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l12 12M13 1L1 13" /></svg>
          </HeaderButton>
        </div>
      </div>

      {/* Conversation tabs (expanded) */}
      {isExpanded && conversations.length > 1 && (
        <div className="asst-panel-tabs">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => void selectConversation(conv.id)}
              className={`asst-conv-tab ${conv.id === activeConversationId ? "asst-conv-tab-active" : ""}`}
            >
              <span className="truncate max-w-[120px]">{conv.title}</span>
              <span
                onClick={(e) => { e.stopPropagation(); void removeConversation(conv.id); }}
                className="asst-conv-tab-delete"
              >×</span>
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="asst-messages">
        {/* Welcome screen */}
        {isEmpty && (
          <div className="asst-welcome">
            {/* 公司 Logo */}
            <div className="relative">
              <div className="asst-welcome-logo">
                <img
                  src="/procurement-brand-logo.png"
                  alt="智慧水发"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="asst-welcome-glow" />
            </div>

            <div>
              <div className="asst-welcome-title">
                {userName && <div>{userName}，</div>}
                <div>你好呀，我是水叮当</div>
              </div>
  {/* 副标题已删除 */}
            </div>

            {/* 选中项上下文 — 占位，后续按需恢复 */}
          </div>
        )}

        {/* Message list */}
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
              onSendFollowUp={(text) => void sendMessage(text)}
            />
          );
        })}

        {/* Thinking indicator (only when streaming with NO content yet) */}
        {isStreaming && !streamingContent && (
          <div className="asst-thinking-row">
            <MiniSprite size={28} expression="thinking" animated />
            <div className="asst-thinking-bubble">
              <span className="thinking-dots"><span /><span /><span /></span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">水叮当在想呢 🤔</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {chatState.error && (
        <div className="asst-error">{chatState.error}</div>
      )}

      {/* Input */}
      <ChatInput onSend={(c) => void sendMessage(c)} disabled={isStreaming} />
    </div>
  );
}

function HeaderButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="asst-header-btn">
      {children}
    </button>
  );
}
