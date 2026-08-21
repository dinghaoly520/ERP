"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { portalURL } from "@water-erp/config";
import {
  BID_EVENT,
  type ConnectionState,
  type DecryptStatusPayload,
  type StageChangePayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningDisputeResolvedPayload,
  type OpeningRecordUpdatedPayload,
  type RoundStatusChangePayload,
} from "@water-erp/shared";

export interface BidWsHandlers {
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onHallMessage?: (d: HallMessagePayload) => void;
  onHallPresence?: (d: HallPresenceUpdatePayload) => void;
  onHallCheckin?: (d: HallCheckinPayload) => void;
  onHallExchangeControl?: (d: HallExchangeControlPayload) => void;
  onOpeningDisputeResolved?: (d: OpeningDisputeResolvedPayload) => void;
  onOpeningRecordUpdated?: (d: OpeningRecordUpdatedPayload) => void;
  onRoundStatusChange?: (d: RoundStatusChangePayload) => void;
}

function wsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  return env || portalURL("api", "/bid");
}

/**
 * /bid 命名空间的供应商端 socket 工程（React 版）。
 * 移植自 Vue useBidWebSocket（其又移植自 bid-portal）：
 * 重连退避 [1s,2s,5s,10s]、20s ping/10s pong 心跳、页面不可见时断开省电。
 * handlers 每渲染取最新闭包（Ref 延迟解引用，等价 Vue 版 holder 间接层）。
 */
export function useBidWebSocket(projectId: string | undefined, getHandlers: () => BidWsHandlers) {
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const handlersRef = useRef(getHandlers);
  handlersRef.current = getHandlers;
  const [nonce, setNonce] = useState(0); // reconnectNow 用

  useEffect(() => {
    if (!projectId) return;
    let socket: Socket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let manualClose = false;
    let disposed = false;

    function clearTimers() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
    }

    function connect() {
      if (disposed || socket?.connected) return;
      manualClose = false;
      setConnection((c) => (c === "connected" ? c : "reconnecting"));

      const s = io(wsUrl(), { withCredentials: true, reconnection: false, timeout: 10000 });
      socket = s;

      s.on("connect", () => {
        attempt = 0;
        setConnection("connected");
        s.emit("join:project", projectId);
        heartbeatTimer = setInterval(() => {
          s.emit("ping", Date.now());
          if (pongTimer) clearTimeout(pongTimer);
          pongTimer = setTimeout(() => s.disconnect(), 10000);
        }, 20000);
      });

      s.on("pong", () => { if (pongTimer) clearTimeout(pongTimer); });

      const scheduleReconnect = () => {
        if (manualClose || disposed) return;
        const delays = [1000, 2000, 5000, 10000];
        attempt = Math.min(attempt + 1, 10);
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        setConnection("reconnecting");
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (socket) { socket.disconnect(); socket = null; }
          connect();
        }, delay);
      };

      s.on("disconnect", () => {
        clearTimers();
        setConnection("disconnected");
        socket = null;
        if (!manualClose) scheduleReconnect();
      });
      s.on("connect_error", () => { setConnection("disconnected"); scheduleReconnect(); });

      // listener 内延迟解引用 handlersRef：事件到达时取最新闭包
      const on = <T,>(ev: string, key: keyof BidWsHandlers) => {
        s.on(ev, (d: T) => {
          const fn = (handlersRef.current() as BidWsHandlers)[key] as ((d: T) => void) | undefined;
          if (fn) { setLastEventAt(Date.now()); fn(d); }
        });
      };
      on(BID_EVENT.DECRYPT_STATUS, "onDecryptStatus");
      on(BID_EVENT.STAGE_CHANGE, "onStageChange");
      on(BID_EVENT.HALL_MESSAGE_NEW, "onHallMessage");
      on(BID_EVENT.HALL_PRESENCE_UPDATE, "onHallPresence");
      on(BID_EVENT.HALL_CHECKIN, "onHallCheckin");
      on(BID_EVENT.HALL_EXCHANGE_CONTROL, "onHallExchangeControl");
      on(BID_EVENT.OPENING_DISPUTE_RESOLVED, "onOpeningDisputeResolved");
      on(BID_EVENT.OPENING_RECORD_UPDATED, "onOpeningRecordUpdated");
      on(BID_EVENT.ROUND_STATUS_CHANGE, "onRoundStatusChange");
    }

    function teardown() {
      manualClose = true;
      clearTimers();
      if (socket) {
        socket.emit("leave:project", projectId);
        socket.disconnect();
        socket = null;
      }
      setConnection("disconnected");
    }

    const onVisibility = () => {
      if (document.hidden) teardown();
      else { manualClose = false; connect(); }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      teardown();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectId, nonce]);

  const reconnectNow = useCallback(() => setNonce((n) => n + 1), []);

  return { connection, lastEventAt, reconnectNow };
}
