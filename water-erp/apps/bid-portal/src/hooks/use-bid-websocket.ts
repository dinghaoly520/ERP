'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { portalURL } from '@water-erp/config';
import {
  BID_EVENT,
  type ConnectionState,
  type DecryptStatusPayload,
  type StageChangePayload,
  type SupervisionLogPayload,
  type AnomalyDetectedPayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningConfirmedPayload,
  type OpeningDisputedPayload,
  type OpeningDisputeResolvedPayload,
  type OpeningCompletedPayload,
  type ExpertPresencePayload,
  type ExpertPresenceAggregatePayload,
} from '@water-erp/shared';

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return portalURL('api', '/bid');
}

/** Phase 3 裁剪：:3007 保留开标执行相关事件组
 * （decrypt / stage / supervision / anomaly / hall / opening）；
 * 评标在场事件已随只读评标管理 tab 回归。
 * 澄清事件仍随澄清答疑留在 :3005。 */
export interface BidWsHandlers {
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onSupervisionLog?: (d: SupervisionLogPayload) => void;
  onAnomalyDetected?: (d: AnomalyDetectedPayload) => void;
  onHallMessage?: (d: HallMessagePayload) => void;
  onHallPresence?: (d: HallPresenceUpdatePayload) => void;
  onHallCheckin?: (d: HallCheckinPayload) => void;
  onHallExchangeControl?: (d: HallExchangeControlPayload) => void;
  onOpeningConfirmed?: (d: OpeningConfirmedPayload) => void;
  onOpeningDisputed?: (d: OpeningDisputedPayload) => void;
  onOpeningDisputeResolved?: (d: OpeningDisputeResolvedPayload) => void;
  onOpeningCompleted?: (d: OpeningCompletedPayload) => void;
  onExpertPresence?: (d: ExpertPresencePayload) => void;
  onExpertPresenceAggregate?: (d: ExpertPresenceAggregatePayload) => void;
}

export interface UseBidWebSocketResult {
  socket: Socket | null;
  connection: ConnectionState;
  lastEventAt: number | null;
  reconnectNow: () => void;
}

export function useBidWebSocket(projectId: string | undefined, handlers: BidWsHandlers): UseBidWebSocketResult {
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const manualClose = useRef(false);

  handlersRef.current = handlers;

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
  }, []);

  const connect = useCallback(() => {
    if (!projectId || socketRef.current?.connected) return;
    manualClose.current = false;
    setConnection(prev => (prev === 'connected' ? prev : 'reconnecting'));

    const socket = io(wsUrl(), {
      withCredentials: true,
      reconnection: false,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      attemptRef.current = 0;
      setConnection('connected');
      socket.emit('join:project', projectId);

      heartbeatTimer.current = setInterval(() => {
        const now = Date.now();
        socket.emit('ping', now);
        if (pongTimer.current) clearTimeout(pongTimer.current);
        pongTimer.current = setTimeout(() => { socket.disconnect(); }, 10000);
      }, 20000);
    });

    socket.on('pong', () => { if (pongTimer.current) clearTimeout(pongTimer.current); });

    const scheduleReconnect = () => {
      if (manualClose.current || !projectId) return;
      const delays = [1000, 2000, 5000, 10000];
      attemptRef.current = Math.min(attemptRef.current + 1, 10);
      const delay = delays[Math.min(attemptRef.current - 1, delays.length - 1)];
      setConnection('reconnecting');
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
        connect();
      }, delay);
    };

    socket.on('disconnect', (reason: string) => {
      clearTimers();
      setConnection('disconnected');
      socketRef.current = null;
      if (manualClose.current) return;
      scheduleReconnect();
    });

    socket.on('connect_error', () => {
      setConnection('disconnected');
      scheduleReconnect();
    });

    // R9：listener 内按 key 延迟解引用 handlersRef.current——事件到达时取最新 handler。
    // （旧实现在连接建立时快照 h.current.onX 的值，后续渲染换上的 handler 永不生效）
    const on = <T,>(ev: string, key: keyof BidWsHandlers) => {
      socket.on(ev, (d: T) => {
        const fn = handlersRef.current[key] as ((d: T) => void) | undefined;
        if (fn) { setLastEventAt(Date.now()); fn(d); }
      });
    };
    on(BID_EVENT.DECRYPT_STATUS, 'onDecryptStatus');
    on(BID_EVENT.STAGE_CHANGE, 'onStageChange');
    on(BID_EVENT.SUPERVISION_LOG, 'onSupervisionLog');
    on(BID_EVENT.ANOMALY_DETECTED, 'onAnomalyDetected');
    on(BID_EVENT.HALL_MESSAGE_NEW, 'onHallMessage');
    on(BID_EVENT.HALL_PRESENCE_UPDATE, 'onHallPresence');
    on(BID_EVENT.HALL_CHECKIN, 'onHallCheckin');
    on(BID_EVENT.HALL_EXCHANGE_CONTROL, 'onHallExchangeControl');
    on(BID_EVENT.OPENING_CONFIRMED, 'onOpeningConfirmed');
    on(BID_EVENT.OPENING_DISPUTED, 'onOpeningDisputed');
    on(BID_EVENT.OPENING_DISPUTE_RESOLVED, 'onOpeningDisputeResolved');
    on(BID_EVENT.OPENING_COMPLETED, 'onOpeningCompleted');
    on(BID_EVENT.EXPERT_PRESENCE, 'onExpertPresence');
    on(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, 'onExpertPresenceAggregate');
  }, [projectId]);

  const reconnectNow = useCallback(() => {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    clearTimers();
    attemptRef.current = 0;
    connect();
  }, [connect, clearTimers]);

  useEffect(() => {
    if (!projectId) return;
    connect();
    return () => {
      manualClose.current = true;
      clearTimers();
      if (socketRef.current) {
        socketRef.current.emit('leave:project', projectId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [projectId, connect, clearTimers]);

  // Suspend/resume WebSocket based on page visibility to save resources
  useEffect(() => {
    if (!projectId) return;
    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden: disconnect to save resources
        manualClose.current = true;
        clearTimers();
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        setConnection('disconnected');
      } else {
        // Tab visible again: reconnect
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [projectId, connect, clearTimers]);

  return { socket: socketRef.current, connection, lastEventAt, reconnectNow };
}
