"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HallMessagePayload } from "@water-erp/shared";
import { openingHallApi } from "@/lib/api/opening-hall";
import { useBidWebSocket } from "@/hooks/use-bid-websocket";

/**
 * 开标大厅交流面板（公聊/私聊）— 移植自 Vue ChatPanel.vue。
 * 保留全部工程注释中的行为：R3 重连 REST 补齐、R4 阶段关闭互动、
 * U2 默认 PUBLIC 清未读、U3 senderId 判己方气泡、U5 错误由全局层弹、
 * Wave 5-5 在途增量合并、中文输入法 Enter 不发送。
 */
type Msg = { id: string; senderId: string; senderRole: string; senderName: string; content: string; createdAt: string; roomType: string };

export function ChatPanel({ projectId, supplierId, supplierName: _supplierName, userId }: {
  projectId: string;
  supplierId: string;
  supplierName: string;
  userId: string;
}) {
  const [tab, setTab] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [publicMsgs, setPublicMsgs] = useState<Msg[]>([]);
  const [privateMsgs, setPrivateMsgs] = useState<Msg[]>([]);
  const [publicUnread, setPublicUnread] = useState(0);
  const [privateUnread, setPrivateUnread] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [exchangeControl, setExchangeControl] = useState<"OPEN" | "MUTED" | "CLOSED">("OPEN");
  const [stageClosed, setStageClosed] = useState(false); // R4：stage:change 离开 OPENING 后关闭互动
  const hydratedRef = useRef(false); // R3：首次加载完成后才在重连时做 REST 补齐
  const wasConnectedRef = useRef(false); // R3：区分首连与断线重连——首连的补齐由挂载 hydrate 覆盖，不重复拉取
  const listEl = useRef<HTMLDivElement | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // 私聊 tab 归并公聊里的 SYSTEM 控制提示（交流控制变更落 PUBLIC 房）——按时间插入排序
  const current = tab === "PUBLIC"
    ? publicMsgs
    : [...privateMsgs, ...publicMsgs.filter((m) => m.senderRole === "SYSTEM")]
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  const canSend = exchangeControl === "OPEN" && !stageClosed;
  const controlHint = stageClosed
    ? "开标阶段已结束，互动已关闭"
    : exchangeControl === "MUTED"
      ? "主持人已开启全员禁言"
      : exchangeControl === "CLOSED"
        ? "主持人已关闭聊天大厅"
        : "";

  const scrollBottom = () => {
    if (listEl.current) listEl.current.scrollTop = listEl.current.scrollHeight;
  };

  const pushMsg = useCallback((d: HallMessagePayload) => {
    const m: Msg = { id: d.id, senderId: d.senderId, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt, roomType: d.roomType };
    if (d.roomType === "PUBLIC") {
      setPublicMsgs((prev) => [...prev, m]);
      if (tabRef.current !== "PUBLIC") setPublicUnread((c) => c + 1);
    } else if (d.supplierId === supplierId) {
      setPrivateMsgs((prev) => [...prev, m]);
      if (tabRef.current !== "PRIVATE") setPrivateUnread((c) => c + 1);
    }
    setTimeout(scrollBottom, 0);
  }, [supplierId]);

  const { connection, reconnectNow } = useBidWebSocket(projectId, () => ({
    onHallMessage: pushMsg,
    onHallExchangeControl: (d) => { setExchangeControl(d.control); },
    // R4：阶段离开 OPENING → 关闭输入（大厅互动仅在开标阶段开放）
    onStageChange: (d) => { if (d.to && d.to !== "OPENING") setStageClosed(true); },
  }));

  /** 返回本次 REST 页的最后一条消息 id（items 按时序升序），供 markRead 上报游标 */
  async function loadHistory(room: "PUBLIC" | "PRIVATE"): Promise<string | undefined> {
    const res = await openingHallApi.messages(projectId, {
      roomType: room,
      supplierId: room === "PRIVATE" ? supplierId : undefined,
      limit: 100,
    });
    const items: Msg[] = (res?.items || []).map((m: any) => ({
      id: m.id, senderId: m.senderId, senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt, roomType: m.roomType,
    }));
    // 与在途 socket 增量合并（按 id 去重）；fresh 只保留比服务端窗口最新一条还新的本地消息（Wave 5-5）
    const target = room === "PUBLIC" ? publicMsgs : privateMsgs;
    const maxIso = items[items.length - 1]?.createdAt;
    const fresh = target.filter((m) => !items.some((i) => i.id === m.id) && (!maxIso || m.createdAt > maxIso));
    const merged = [...items, ...fresh];
    if (room === "PUBLIC") setPublicMsgs(merged);
    else setPrivateMsgs(merged);
    setTimeout(scrollBottom, 0);
    return items[items.length - 1]?.id;
  }

  async function loadUnread() {
    const res = await openingHallApi.unread(projectId);
    setPublicUnread(res?.public ?? 0);
    setPrivateUnread(res?.private ?? 0);
  }

  /** 首屏挂载与 R3 重连补齐共用：重拉双聊天历史 + 未读，再对当前 tab 即时 markRead */
  const hydrate = useCallback(async () => {
    const [pub, priv] = await Promise.allSettled([loadHistory("PUBLIC"), loadHistory("PRIVATE")]);
    await loadUnread().catch(() => {});
    hydratedRef.current = true;
    // U2：默认停留 PUBLIC——未读即时清零，游标定在已加载末条
    if (tabRef.current === "PUBLIC") {
      setPublicUnread(0);
      await openingHallApi.markRead(projectId, "public", pub.status === "fulfilled" ? pub.value : undefined).catch(() => {});
    } else {
      setPrivateUnread(0);
      await openingHallApi.markRead(projectId, `supplier:${supplierId}`, priv.status === "fulfilled" ? priv.value : undefined).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, supplierId]);

  useEffect(() => { hydrate(); }, [hydrate]);

  // R3：断线后重连成功且已首次加载过 → 重跑 hydrate 补齐断线窗口。
  // 首次连接不算重连（此前无 wasConnected 判断，每次进页面 messages/unread/read 都拉两遍）
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnectedRef.current && hydratedRef.current) hydrate();
    wasConnectedRef.current = true;
  }, [connection, hydrate]);

  async function switchTab(t: "PUBLIC" | "PRIVATE") {
    setTab(t);
    tabRef.current = t;
    if (t === "PUBLIC") {
      setPublicUnread(0);
      await openingHallApi.markRead(projectId, "public", publicMsgs[publicMsgs.length - 1]?.id).catch(() => {});
    } else {
      setPrivateUnread(0);
      await openingHallApi.markRead(projectId, `supplier:${supplierId}`, privateMsgs[privateMsgs.length - 1]?.id).catch(() => {});
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await openingHallApi.send(projectId, {
        roomType: tab,
        supplierId: tab === "PRIVATE" ? supplierId : undefined,
        content,
      });
      setInput("");
    } catch {
      // U5：业务错误消息已由全局 API 层统一弹出，此处不重复提示
    } finally {
      setSending(false);
    }
  }

  // 中文输入法组合期（isComposing / keyCode 229）的 Enter 是选词确认，不发送
  function onEnter(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing || (e.nativeEvent as any).keyCode === 229) return;
    send();
  }

  // 时间格式：当天仅显示时刻，跨天带月日
  function fmtTime(iso: string): string {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString("zh-CN")
      : d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div className="tabs">
          <span className="cp-tab-badge">
            <button type="button" className={`cp-tab${tab === "PUBLIC" ? " on" : ""}`} onClick={() => switchTab("PUBLIC")}>大厅公聊</button>
            {publicUnread > 0 && <span className="cp-badge">{publicUnread > 99 ? "99+" : publicUnread}</span>}
          </span>
          <span className="cp-tab-badge">
            <button type="button" className={`cp-tab${tab === "PRIVATE" ? " on" : ""}`} onClick={() => switchTab("PRIVATE")}>与主持人私聊</button>
            {privateUnread > 0 && <span className="cp-badge">{privateUnread > 99 ? "99+" : privateUnread}</span>}
          </span>
          {/* R10：连接态徽标；断开时给手动重连入口 */}
          <span className={`conn conn-${connection}`}>
            <span className="conn-dot" />
            {connection === "connected" ? "实时已连" : connection === "reconnecting" ? "重连中…" : "已断开"}
            {connection === "disconnected" && (
              <button type="button" className="cp-reconnect" onClick={reconnectNow}>重连</button>
            )}
          </span>
        </div>
      </div>

      <div ref={listEl} className="msg-list">
        {current.length === 0 && <div className="empty">暂无消息</div>}
        {current.map((m) =>
          m.senderRole === "SYSTEM" ? (
            // 系统消息：居中提示条
            <div key={m.id} className="sys-tip">{m.content}</div>
          ) : (
            // 气泡式：己方右对齐（U3：按 senderId 判定），对方左对齐带头像
            <div key={m.id} className={`chat-row${m.senderId === userId ? " is-mine" : ""}`}>
              <div className={`avatar${m.senderRole === "HOST" ? " avatar-host" : ""}`}>{(m.senderName || "?").slice(0, 1)}</div>
              <div className="bubble-col">
                <div className="meta">{m.senderName} · {fmtTime(m.createdAt)}</div>
                <div className="bubble">{m.content}</div>
              </div>
            </div>
          ),
        )}
      </div>

      {!canSend && <div className="muted-hint">{controlHint}</div>}
      <div className="input-row">
        {/* keydown 而非 keyup：Chromium compositionend 先于 keyup，keyup 时 isComposing 已失效 */}
        <input
          className="cp-input"
          value={input}
          disabled={!canSend}
          maxLength={2000}
          placeholder="输入消息（Enter 发送）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter(e); }}
        />
        <button type="button" className="cp-send" disabled={!canSend || !input.trim() || sending} onClick={send}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
