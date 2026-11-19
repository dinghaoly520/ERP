"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Check, Copy, History, Plus, RefreshCw, SendHorizonal, Sparkles, Square, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useAuth } from "@/components/m/auth-context";
import { sendChat, sendFeedback, fetchMyFeedback, fetchConversation, fetchConversationList, removeConversation, type ChatMessage, type ConversationSummary } from "@/lib/api/assistant";
import { Skeleton } from "@/components/m/skeleton";
import { EmptyState } from "@/components/m/empty-state";
import { readSavedFilters } from "@/lib/filter-store";
import { ChatCardView } from "@/components/m/chat-card";
import { BottomSheet } from "@/components/m/bottom-sheet";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { ApiError } from "@water-erp/client";

const CONV_KEY = "m-shuidingdang-conversation";
const QUICK_QUESTIONS = ["本月成交总额多少", "当前最大风险是什么", "节资排名前三", "哪个阶段最堵"];

/** 追问 chip（2026-11-19 四件套，本地启发式——同 :3005 思路移动端适配）：
 *  数据类回答给趋势/风险两个方向；长文给简明化；短答给展开 */
function followUpsOf(m: { content: string; cards?: unknown[] }): string[] {
  const hasData = (m.cards?.length ?? 0) > 0 || /\d/.test(m.content);
  if (hasData) return ["这些数据的变化趋势如何", "有哪些风险项"];
  return m.content.length > 160 ? ["能再简明一点吗", "还有哪些相关信息"] : ["能展开说说吗"];
}

export default function ChatPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [messages, setMessages] = useState<Array<ChatMessage & { failedQ?: string }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /* 四件套（2026-11-19 问答改造）状态：停止（AbortController）、复制反馈、点赞点踩回显 */
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "UP" | "DOWN">>({});

  /* 会话切换/载入后拉我的反馈回显（失败静默——回显缺失不影响主流程） */
  function loadFeedback(convId: string | null) {
    if (!convId) return;
    fetchMyFeedback(convId)
      .then((rows) => setFeedback(Object.fromEntries(rows.map((r) => [r.messageId, r.rating]))))
      .catch(() => undefined);
  }
  // admin 口径标签展示值：驾驶舱页公司选择器已撤（2026-11-19 固定全部公司）——
  // 历史存量 filter-store 值仅作展示回显，发送时 doAsk() 内再读一次真实值
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
          (c.messages ?? []).slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, cards: m.cardsJson ?? [], id: m.role === "assistant" ? m.id : undefined })),
        );
        loadFeedback(saved);
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
    // 读后清 ?q=（replaceState 不留历史）：防刷新/回退重复预填（R1-1）
    if (q !== null) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  /* 历史会话回看（2026-10-27）：服务端按属主隔离存档，换机/隔天可找回；删除当前会话自动开新 */
  const [historyOpen, setHistoryOpen] = useState(false);
  // 待确认删除的会话 id（2026-11-06：底部弹层二次确认，替代原生 window.confirm）
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [historyList, setHistoryList] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false); // R3-1：失败≠空，须可重试

  function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(false);
    fetchConversationList()
      .then((list) => setHistoryList(list ?? []))
      .catch(() => {
        setHistoryList([]);
        setHistoryError(true);
      })
      .finally(() => setHistoryLoading(false));
  }

  async function loadHistory(id: string) {
    try {
      const c = await fetchConversation(id);
      if (!c) return;
      setConversationId(id);
      setMessages(
        (c.messages ?? []).slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, cards: m.cardsJson ?? [], id: m.role === "assistant" ? m.id : undefined })),
      );
      localStorage.setItem(CONV_KEY, id);
      loadFeedback(id);
      setHistoryOpen(false);
    } catch { /* 载入失败留在列表 */ }
  }

  async function deleteHistory(id: string) {
    /* 破坏性操作防误触（P2，2026-11-03）：一触即删且不可恢复；
     * 2026-11-06 用户裁定弃原生 window.confirm，改底部弹层确认（本门户弹窗形态） */
    setDeleteTarget(id);
  }

  async function confirmDeleteHistory() {
    const id = deleteTarget;
    if (!id) return;
    setDeleteTarget(null);
    try { await removeConversation(id); } catch { /* 删除失败不阻塞列表刷新 */ }
    if (id === conversationId) newConversation();
    setHistoryList((prev) => prev.filter((c) => c.id !== id));
  }

  /* 键盘协同（2026-10-26 用户裁定 tabbar 不随键盘抬升）：VirtualKeyboard.overlaysContent
   * 让键盘覆盖而非压缩布局，--kb-h 由 visualViewport 驱动输入条抬升/消息区避让；
   * iOS 无 VirtualKeyboard——键盘本就不压缩布局，同一通道仍生效。 */
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
    if (!q) return; // 在途不拦——新提问自动中止旧请求（:3005 借鉴），见 doAsk
    setInput("");
    /* 程序清空不触发 onInput——自增高 textarea 手动复位单行高（.m-input 定高 44
     * 被内联高度覆盖后，键盘清空有 input 事件、此处发送清空没有） */
    if (taRef.current) taRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    await doAsk(q);
  }

  /* 驾驶舱 KPI 直达问询（2026-11-19 用户裁定）：/chat?ask=<问句> 挂载即自动发送一次
   * （ref 闸防 StrictMode/重渲染双发；问句由驾驶舱按所点指标+口径生成） */
  const searchParams = useSearchParams();
  const autoAskRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("ask");
    if (!q || autoAskRef.current) return;
    autoAskRef.current = true;
    ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* 发送核心（ask 与失败重试/重新生成共用——重试不重复追加用户气泡，R1-2）。
   * 稳健三件（2026-11-19 借鉴 :3005/:3008）：① 新提问自动中止在途请求（不卡等停止钮）；
   * ② 90s 超时兜底（两轮 LLM+工具可至 60s+，:3008 同值）——超时与用户停止分流文案；
   * ③ 服务端错误消息透出（ApiError.message 是后端归一中文文案，如「会话不存在，
   * 请刷新页面重试」），仅网络级错误才用兜底话术。主动取消不落错误气泡（服务端
   * 可能已把回答落库——重新打开会话可见，属可接受语义）。 */
  async function doAsk(q: string) {
    if (abortRef.current) {
      abortRef.current.abort(); // 在途请求被新提问取代——静默中止
      abortRef.current = null;
    }
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    // 发送时读公司口径（fresh 值，不用挂载期闭包）——驾驶舱选择器已撤，正常恒为空=全部公司
    const adminCompanyIds = isAdmin
      ? (readSavedFilters<{ companyIds: string[] }>("dashboard").companyIds ?? [])
      : undefined;
    try {
      const r = await sendChat(q, conversationId, adminCompanyIds?.length ? adminCompanyIds : undefined, controller.signal);
      if (r.conversationId) { setConversationId(r.conversationId); localStorage.setItem(CONV_KEY, r.conversationId); }
      setMessages((prev) => [...prev, { role: "assistant", content: r.answer, cards: r.cards ?? [], id: r.messageId }]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError" && !timedOut) return; // 用户停止/被新问取代
      const hint =
        timedOut ? "请求超时，请重试"
        : err instanceof ApiError && err.code !== "NETWORK_ERROR" ? err.message
        : "网络开小差，这条没发出去";
      setMessages((prev) => [...prev, { role: "assistant", content: hint, failedQ: q }]);
    } finally {
      window.clearTimeout(timeoutId);
      abortRef.current = null;
      setSending(false);
    }
  }

  function stopSending() {
    abortRef.current?.abort();
  }

  /** 重新生成（2026-11-19 四件套）：取最后一条回答之前的用户提问重发（追加新问答，
   *  不覆盖——服务端历史即完整审计轨迹） */
  function regenerate() {
    if (sending) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].content.trim()) {
        void ask(messages[i].content);
        return;
      }
    }
  }

  /** 点赞/点踩（2026-11-19 反馈落库）：服务端同值再点=取消，本地镜像返回态 */
  async function rate(messageId: string | undefined, rating: "UP" | "DOWN") {
    if (!messageId || sending) return;
    try {
      const r = await sendFeedback(messageId, rating);
      setFeedback((prev) => {
        const next = { ...prev };
        if (r.rating) next[messageId] = r.rating;
        else delete next[messageId];
        return next;
      });
    } catch { /* 反馈失败静默 */ }
  }

  async function copyAnswer(i: number, content: string) {
    const ok = await copyToClipboard(content);
    if (!ok) return;
    setCopiedIdx(i);
    window.setTimeout(() => setCopiedIdx((v) => (v === i ? null : v)), 1600);
  }

  async function retryAsk(q: string) {
    if (sending) return;
    setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.failedQ === q)));
    await doAsk(q);
  }

  /* 新对话懒创建（2026-11-04 审查 D 批）：不再预建空会话（历史弹层堆积「（无标题）」
   * 空行）；仅清本地态，首次提问时 sendChat 无 conversationId 由后端自动建会话 */
  function newConversation() {
    setConversationId(null);
    localStorage.removeItem(CONV_KEY);
    setMessages([]);
    setFeedback({});
  }

  return (
    /* 有界 fixed 壳（.m-chat-shell，见 globals.css）：top=header 44px、bottom=tabbar——消息区
     * 成唯一滚动容器，输入条钉在 tabbar 上方；不再依赖 min-h+主容器滚动的魔法高差 */
    <div ref={shellRef} className="m-chat-shell">
      {/* 顶部：返回 + 口径标签 + 历史/新对话（2026-11-19 用户裁定：补返回按钮） */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label="返回驾驶舱"
          className="neu-btn-soft h-9 w-9 shrink-0 rounded-[11px] p-0 active:scale-95"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-[var(--muted-foreground)]">
          <Bot size={13} className="shrink-0 text-[var(--accent)]" />
          {isAdmin
            ? adminScopeCount > 0
              ? `当前范围：已选 ${adminScopeCount} 家公司`
              : "当前范围：全部公司"
            : "当前范围：本公司数据"}
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
          messages.map((m, i) => {
            const isLastMsg = i === messages.length - 1;
            const showActions = m.role === "assistant" && !m.failedQ;
            return (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={m.role === "user" ? "max-w-[85%] rounded-[14px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]" : "max-w-[92%]"}>
                  {m.role === "assistant" ? (
                    <div className="rounded-[14px] neu-card-static px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]">
                      {m.content}
                      {m.failedQ ? (
                        <button type="button" onClick={() => retryAsk(m.failedQ as string)} className="m-chip mt-1.5">
                          <RefreshCw size={11} /> 重试
                        </button>
                      ) : null}
                      {(m.cards ?? []).map((c, j) => <ChatCardView key={j} card={c} />)}
                      {showActions ? (
                        <>
                          {/* 操作行（2026-11-19 四件套+反馈）：复制 / 点赞点踩 / 重新生成（仅末条） */}
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="复制回答"
                              onClick={() => void copyAnswer(i, m.content)}
                              className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[var(--muted-foreground)] active:scale-90"
                            >
                              {copiedIdx === i ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                            </button>
                            <button
                              type="button"
                              aria-label="回答有帮助"
                              aria-pressed={m.id ? feedback[m.id] === "UP" : false}
                              onClick={() => void rate(m.id, "UP")}
                              className={`flex h-8 w-8 items-center justify-center rounded-[9px] active:scale-90 ${m.id && feedback[m.id] === "UP" ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}`}
                            >
                              <ThumbsUp size={13} />
                            </button>
                            <button
                              type="button"
                              aria-label="回答有问题"
                              aria-pressed={m.id ? feedback[m.id] === "DOWN" : false}
                              onClick={() => void rate(m.id, "DOWN")}
                              className={`flex h-8 w-8 items-center justify-center rounded-[9px] active:scale-90 ${m.id && feedback[m.id] === "DOWN" ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}
                            >
                              <ThumbsDown size={13} />
                            </button>
                            {isLastMsg && !sending ? (
                              <button type="button" onClick={regenerate} className="m-chip ml-1">
                                <RefreshCw size={11} /> 重新生成
                              </button>
                            ) : null}
                          </div>
                          {/* 追问 chip（仅末条回答、空闲时） */}
                          {isLastMsg && !sending ? (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {followUpsOf(m).map((f) => (
                                <button key={f} type="button" onClick={() => ask(f)} className="m-chip">
                                  <Sparkles size={11} /> {f}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : m.content}
                </div>
              </div>
            );
          })
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
        {/* 自增高输入框（:3005 chat-input 借鉴）：单行 input 长问题可视截断；
            手机键盘 Enter=换行，发送只走按钮（桌面 Enter 直发不适用移动端） */}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点什么…"
          rows={1}
          aria-label="提问输入框"
          className="m-input min-h-[44px] max-h-[96px] w-full flex-1 resize-none rounded-[14px] py-2.5 leading-snug"
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
          }}
          /* 键盘开启隐藏 tabbar（用户裁定 2026-10-26）：body 挂类驱动 CSS（globals.css
           * body.m-kb-open），失焦/卸载即恢复——不依赖键盘 API，两类 webview 行为均成立 */
          onFocus={() => document.body.classList.add("m-kb-open")}
          onBlur={() => document.body.classList.remove("m-kb-open")}
        />
        {sending && !input.trim() ? (
          /* 停止生成（2026-11-19 四件套）：发送中且未输入新内容 → 停止钮；
              有新内容则显示发送钮（发送即中止旧问——:3005 借鉴） */
          <button type="button" aria-label="停止生成" onClick={stopSending}
            className="neu-btn-soft h-11 w-11 shrink-0 rounded-[14px] p-0 active:scale-95">
            <Square size={13} className="fill-[var(--foreground)]" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} aria-label="发送"
            className="neu-btn-primary h-11 w-11 shrink-0 rounded-[14px] p-0 disabled:opacity-50">
            <SendHorizonal size={16} />
          </button>
        )}
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
        ) : historyError ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <EmptyState text="历史会话加载失败" />
            <button type="button" onClick={openHistory} className="m-chip">
              <RefreshCw size={11} /> 重试
            </button>
          </div>
        ) : historyList.length ? (
          <div className="space-y-1.5">
            {historyList.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-[10px] m-tile px-3 py-2.5">
                <button type="button" onClick={() => loadHistory(c.id)} className="flex min-w-0 flex-1 flex-col text-left active:scale-[0.99]">
                  <span className="truncate text-[14px] font-medium text-[var(--foreground)]">{c.firstMessage || c.title || "（无标题）"}</span>
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

      {/* 删除会话二次确认（2026-11-06：底部弹层形态，替代原生 window.confirm） */}
      <BottomSheet open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="删除会话">
        <div className="space-y-3 px-4 pb-5 pt-1">
          <p className="text-[14px] leading-relaxed text-[var(--muted-foreground)]">删除该会话？删除后不可恢复。</p>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setDeleteTarget(null)} className="neu-btn-soft h-11 flex-1 rounded-[12px] text-[14px] active:scale-95">
              取消
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteHistory()}
              className="neu-btn-primary h-11 flex-1 rounded-[12px] text-[14px] font-semibold !bg-[var(--danger)] active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
