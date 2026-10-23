"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Plus, SendHorizonal, Sparkles } from "lucide-react";
import { useAuth } from "@/components/m/auth-context";
import { sendChat, fetchConversation, createConversation, type ChatMessage } from "@/lib/api/assistant";
import { ChatCardView } from "@/components/m/chat-card";

const CONV_KEY = "m-shuidingdang-conversation";
const QUICK_QUESTIONS = ["本月成交额多少", "当前最大风险是什么", "节资排名前三", "哪个阶段最堵"];

export default function ChatPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(CONV_KEY);
    if (!saved) return;
    fetchConversation(saved)
      .then((c) => {
        // 后端对不存在/非属主会话返回 200 + null（不泄露存在性）——清本地续接键开新会话
        if (!c) throw new Error("conversation not found");
        setConversationId(saved);
        setMessages(
          (c.messages ?? []).slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, cards: m.cardsJson ?? [] })),
        );
      })
      .catch(() => {
        setConversationId(null);
        localStorage.removeItem(CONV_KEY);
      });
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    try {
      const r = await sendChat(q, conversationId);
      if (r.conversationId) { setConversationId(r.conversationId); localStorage.setItem(CONV_KEY, r.conversationId); }
      setMessages((prev) => [...prev, { role: "assistant", content: r.answer, cards: r.cards ?? [] }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "抱歉，水叮当暂时开小差了，请稍后再试。" }]);
    } finally {
      setSending(false);
    }
  }

  async function newConversation() {
    try {
      const c = await createConversation();
      setConversationId(c.id);
      localStorage.setItem(CONV_KEY, c.id);
      setMessages([]);
    } catch { /* 失败保留当前会话 */ }
  }

  return (
    // 外层 (main) 是滚动容器且上方还有欢迎卡——固定视口高差（header 44 + pt 14 + 欢迎卡 ~85 + pb 16 + tabbar ~55 ≈ 214px ≈ 13.5rem，
    // 另减 iOS 底部安全区——tabbar padding-bottom 随刘海屏增高），让消息区在自身内部滚动、输入条钉底，父容器不出现第二根滚动条
    <div className="flex min-h-[calc(100dvh-13.5rem-env(safe-area-inset-bottom))] flex-col">
      {/* 顶部：口径标签 + 新对话 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-[var(--muted-foreground)]">
          <Bot size={13} className="shrink-0 text-[var(--accent)]" />
          {isAdmin ? "当前口径：全部公司（可在数据库页切换后提问）" : "当前口径：本公司数据"}
        </span>
        <button type="button" onClick={newConversation} className="neu-btn-soft h-8 shrink-0 rounded-[9px] px-2.5 text-[13px] active:scale-95">
          <Plus size={12} /> 新对话
        </button>
      </div>

      {/* 消息流 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]">
              <Bot size={22} className="text-[var(--accent)]" />
            </div>
            <p className="text-[15px] font-bold text-[var(--foreground)]">你好，我是水叮当</p>
            <p className="text-center text-[13px] text-[var(--muted-foreground)]">问我任何采购数据问题，我基于你权限内的真实数据作答</p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => ask(q)} className="m-chip">
                  <Sparkles size={11} /> {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user" ? "max-w-[85%] rounded-[14px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]" : "max-w-[92%]"}>
                {m.role === "assistant" ? (
                  <div className="rounded-[14px] neu-card-static px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]">
                    {m.content}
                    {(m.cards ?? []).map((c, j) => <ChatCardView key={j} card={c} />)}
                  </div>
                ) : m.content}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-[14px] neu-card-static px-3.5 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0.3s]" />
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* 输入条 */}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-center gap-2 pt-1"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点什么…"
          className="m-input h-11 min-w-0 flex-1 rounded-[14px]"
        />
        <button type="submit" disabled={!input.trim() || sending} aria-label="发送"
          className="neu-btn-primary h-11 w-11 shrink-0 rounded-[14px] p-0 disabled:opacity-50">
          <SendHorizonal size={16} />
        </button>
      </form>
    </div>
  );
}
