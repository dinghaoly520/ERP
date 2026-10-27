"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, History, Plus, SendHorizonal, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/components/m/auth-context";
import { sendChat, fetchConversation, createConversation, fetchConversationList, removeConversation, type ChatMessage, type ConversationSummary } from "@/lib/api/assistant";
import { Skeleton } from "@/components/m/skeleton";
import { EmptyState } from "@/components/m/empty-state";
import { readSavedFilters } from "@/lib/filter-store";
import { ChatCardView } from "@/components/m/chat-card";
import { BottomSheet } from "@/components/m/bottom-sheet";

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
  // admin 口径标签展示值：读数据库页当前公司选择，挂载 + 回前台（visibilitychange）时刷新；
  // 发送提问时在 ask() 内再读一次真实值，标签只作展示不作数据源
  const [adminScopeCount, setAdminScopeCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    const refreshScope = () =>
      setAdminScopeCount(readSavedFilters<{ companyIds: string[] }>("dashboard").companyIds?.length ?? 0);
    refreshScope();
    document.addEventListener("visibilitychange", refreshScope);
    return () => document.removeEventListener("visibilitychange", refreshScope);
  }, [isAdmin]);

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

  /* 要报「问水叮当」携问预填（?q=，只预填不自动发送；ref 防严格模式双执行，2026-10-27） */
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current) return;
    askedRef.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q?.trim()) setInput(q.trim());
  }, []);

  /* 历史会话回看（2026-10-27）：服务端按属主隔离存档，换机/隔天可找回；删除当前会话自动开新 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    fetchConversationList()
      .then((list) => setHistoryList(list ?? []))
      .catch(() => setHistoryList([]))
      .finally(() => setHistoryLoading(false));
  }

  async function loadHistory(id: string) {
    try {
      const c = await fetchConversation(id);
      if (!c) return;
      setConversationId(id);
      setMessages(
        (c.messages ?? []).slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, cards: m.cardsJson ?? [] })),
      );
      localStorage.setItem(CONV_KEY, id);
      setHistoryOpen(false);
    } catch { /* 载入失败留在列表 */ }
  }

  async function deleteHistory(id: string) {
    try { await removeConversation(id); } catch { /* 删除失败不阻塞列表刷新 */ }
    if (id === conversationId) newConversation();
    setHistoryList((prev) => prev.filter((c) => c.id !== id));
  }

  /* 键盘协同（2026-10-26）：VirtualKeyboard.overlaysContent 让键盘覆盖而非压缩布局——
   * tabbar 留在屏幕底部（用户裁定：不随键盘抬升）；--kb-h 由 visualViewport 实时驱动，
   * 输入条（.m-chat-dock）抬到键盘上方、消息区（.m-chat-scroll）垫高避让。
   * iOS 无 VirtualKeyboard——键盘本就不压缩布局，visualViewport 通道同样生效。 */
  const shellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const vk = (navigator as Navigator & { keyboard?: { overlaysContent?: boolean } }).keyboard;
    if (vk) vk.overlaysContent = true;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      shellRef.current?.style.setProperty("--kb-h", kb > 60 ? `${Math.round(kb)}px` : "0px");
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      if (vk) vk.overlaysContent = false;
      document.body.classList.remove("m-kb-open");
    };
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    // 发送时读数据库页当前公司口径（fresh 值，不用挂载期闭包）——admin 选中公司后提问按该口径作答
    const adminCompanyIds = isAdmin
      ? (readSavedFilters<{ companyIds: string[] }>("dashboard").companyIds ?? [])
      : undefined;
    try {
      const r = await sendChat(q, conversationId, adminCompanyIds?.length ? adminCompanyIds : undefined);
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
    /* 有界 fixed 壳（.m-chat-shell，见 globals.css）：top=header 44px、bottom=tabbar——消息区
     * 成唯一滚动容器，输入条钉在 tabbar 上方；不再依赖 min-h+主容器滚动的魔法高差 */
    <div ref={shellRef} className="m-chat-shell">
      {/* 顶部：口径标签 + 新对话 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-[var(--muted-foreground)]">
          <Bot size={13} className="shrink-0 text-[var(--accent)]" />
          {isAdmin
            ? adminScopeCount > 0
              ? `当前口径：已选 ${adminScopeCount} 家公司（数据库页可切换）`
              : "当前口径：全部公司（数据库页可切换）"
            : "当前口径：本公司数据"}
        </span>
        <button type="button" onClick={openHistory} className="neu-btn-soft h-8 shrink-0 rounded-[9px] px-2.5 text-[13px] active:scale-95">
          <History size={12} /> 历史
        </button>
        <button type="button" onClick={newConversation} className="neu-btn-soft h-8 shrink-0 rounded-[9px] px-2.5 text-[13px] active:scale-95">
          <Plus size={12} /> 新对话
        </button>
      </div>

      {/* 消息流（唯一滚动容器；底部垫 --kb-h 避让抬升后的输入条） */}
      <div className="m-chat-scroll space-y-3">
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

      {/* 输入条（键盘开启时 .m-chat-dock 抬至键盘上方，tabbar 不动） */}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="m-chat-dock flex items-center gap-2 pt-1"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点什么…"
          className="m-input h-11 min-w-0 flex-1 rounded-[14px]"
          /* 键盘开启隐藏 tabbar（用户裁定 2026-10-26）：body 挂类驱动 CSS（globals.css
           * body.m-kb-open），失焦/卸载即恢复——不依赖键盘 API，两类 webview 行为均成立 */
          onFocus={() => document.body.classList.add("m-kb-open")}
          onBlur={() => document.body.classList.remove("m-kb-open")}
        />
        <button type="submit" disabled={!input.trim() || sending} aria-label="发送"
          className="neu-btn-primary h-11 w-11 shrink-0 rounded-[14px] p-0 disabled:opacity-50">
          <SendHorizonal size={16} />
        </button>
      </form>

      {/* 历史会话回看弹层 */}
      <BottomSheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <History size={16} className="text-[var(--accent)]" />
            历史会话
          </span>
        }
      >
        {historyLoading ? (
          <Skeleton lines={4} height={20} />
        ) : historyList.length ? (
          <div className="space-y-1.5">
            {historyList.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-[10px] m-tile px-3 py-2.5">
                <button type="button" onClick={() => loadHistory(c.id)} className="flex min-w-0 flex-1 flex-col text-left active:scale-[0.99]">
                  <span className="truncate text-[14px] font-medium text-[var(--foreground)]">{c.messages?.[0]?.content ?? "（无标题）"}</span>
                  <span className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{(c.updatedAt ?? "").slice(0, 10)} · {c.id === conversationId ? "当前会话" : "点击载入"}</span>
                </button>
                <button type="button" aria-label="删除会话" onClick={() => deleteHistory(c.id)} className="neu-btn-soft h-8 w-8 shrink-0 rounded-[10px] p-0 active:scale-95">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="暂无历史会话" />
        )}
      </BottomSheet>
    </div>
  );
}
