'use client';

/**
 * 招投标实时事件 hook（移植自 apps/bid-portal/src/hooks/use-bid-websocket.ts，保持同步）。
 * :3005 开评标指挥中心用：开标进度（decrypt:status / opening:confirmed / opening:disputed）、
 * 阶段流转（stage:change）、评标在场（expert:presence）等事件触发增量刷新。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { portalURL } from '@water-erp/config';
import {
  BID_EVENT,
  type ConnectionState,
  type DecryptStatusPayload,
  type StageChangePayload,
  type EvaluationStartedPayload,
  type ExpertPresencePayload,
  type ExpertPresenceAggregatePayload,
  type ClarificationCreatedPayload,
  type ClarificationRepliedPayload,
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
} from '@water-erp/shared';

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return portalURL('api', '/bid');
}

export interface BidWsHandlers {
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onEvaluationStarted?: (d: EvaluationStartedPayload) => void;
  onExpertPresence?: (d: ExpertPresencePayload) => void;
  onExpertPresenceAggregate?: (d: ExpertPresenceAggregatePayload) => void;
  onClarificationCreated?: (d: ClarificationCreatedPayload) => void;
  onClarificationReplied?: (d: ClarificationRepliedPayload) => void;
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
  /** F13：断线重连成功后触发（首连不触发）——供调用方做全量补偿刷新 */
  onReconnected?: () => void;
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
  const hasConnectedOnce = useRef(false);
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

      // F13：重连（非首连）成功 → 通知调用方全量补偿刷新（断线窗口内的事件无法补推）
      if (hasConnectedOnce.current) handlersRef.current.onReconnected?.();
      hasConnectedOnce.current = true;

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

    // Bind event handlers via ref for stale-closure safety
    const on = <T,>(ev: string, fn: ((d: T) => void) | undefined) => {
      socket.on(ev, (d: T) => {
        if (fn) { setLastEventAt(Date.now()); fn(d); }
      });
    };
    const h = handlersRef;
    on(BID_EVENT.DECRYPT_STATUS, h.current.onDecryptStatus);
    on(BID_EVENT.STAGE_CHANGE, h.current.onStageChange);
    on(BID_EVENT.EVALUATION_STARTED, h.current.onEvaluationStarted);
    on(BID_EVENT.EXPERT_PRESENCE, h.current.onExpertPresence);
    on(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, h.current.onExpertPresenceAggregate);
    on(BID_EVENT.CLARIFICATION_CREATED, h.current.onClarificationCreated);
    on(BID_EVENT.CLARIFICATION_REPLIED, h.current.onClarificationReplied);
    on(BID_EVENT.SUPERVISION_LOG, h.current.onSupervisionLog);
    on(BID_EVENT.ANOMALY_DETECTED, h.current.onAnomalyDetected);
    on(BID_EVENT.HALL_MESSAGE_NEW, h.current.onHallMessage);
    on(BID_EVENT.HALL_PRESENCE_UPDATE, h.current.onHallPresence);
    on(BID_EVENT.HALL_CHECKIN, h.current.onHallCheckin);
    on(BID_EVENT.HALL_EXCHANGE_CONTROL, h.current.onHallExchangeControl);
    on(BID_EVENT.OPENING_CONFIRMED, h.current.onOpeningConfirmed);
    on(BID_EVENT.OPENING_DISPUTED, h.current.onOpeningDisputed);
    on(BID_EVENT.OPENING_DISPUTE_RESOLVED, h.current.onOpeningDisputeResolved);
    on(BID_EVENT.OPENING_COMPLETED, h.current.onOpeningCompleted);
  }, [projectId]);

  const reconnectNow = useCallback(() => {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    clearTimers();
    attemptRef.current = 0;
    connect();
  }, [connect, clearTimers]);

  useEffect(() => {
    if (!projectId) return;
    hasConnectedOnce.current = false;
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
