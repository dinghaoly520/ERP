'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ConnectionState, ExpertPresenceAggregatePayload, DecryptStatusPayload, StageChangePayload, ClarificationCreatedPayload, ClarificationRepliedPayload, BidValidityChangePayload, HallMessagePayload, ScoresSubmittedPayload, DraftSavedPayload } from '@water-erp/shared';
import { BID_EVENT } from '@water-erp/shared';
import { portalURL } from '@water-erp/config';

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return portalURL('api', '/bid');
}

interface Handlers {
  onAggregatePresence?: (d: ExpertPresenceAggregatePayload) => void;
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onClarificationCreated?: (d: ClarificationCreatedPayload) => void;
  onClarificationReplied?: (d: ClarificationRepliedPayload) => void;
  onBidValidityChange?: (d: BidValidityChangePayload) => void;
  /** D1: 开标大厅公聊消息 */
  onHallMessage?: (d: HallMessagePayload) => void;
  /** G1: 重连后回调——组件可执行全量数据刷新补偿丢失的事件 */
  onReconnected?: () => void;
  /** 评分提交通知（不含分数值）——同项目其他专家提交了评分，接收端自行刷新 */
  onScoresSubmitted?: (d: ScoresSubmittedPayload) => void;
  /** 草稿保存通知——对方设备保存了草稿，本端自行从服务端拉取合并 */
  onDraftSaved?: (d: DraftSavedPayload) => void;
}

export function useExpertWebSocket(projectId: string | undefined, handlers: Handlers) {
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const manualClose = useRef(false);
  // G1: 首次连接 vs 重连鉴别
  const hasConnectedOnce = useRef(false);
  handlersRef.current = handlers;

  /** 绑定业务事件处理（通过 ref key-based 避免闭包过期，与 bid-portal 对齐） */
  function bindBusinessEvents(socket: Socket) {
    const on = <T,>(ev: string, key: keyof Handlers) => {
      socket.on(ev, (d: T) => {
        const fn = handlersRef.current[key] as ((d: T) => void) | undefined;
        if (fn) { setLastEventAt(Date.now()); fn(d); }
      });
    };
    on(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, 'onAggregatePresence');
    on(BID_EVENT.DECRYPT_STATUS, 'onDecryptStatus');
    on(BID_EVENT.STAGE_CHANGE, 'onStageChange');
    on(BID_EVENT.CLARIFICATION_CREATED, 'onClarificationCreated');
    on(BID_EVENT.CLARIFICATION_REPLIED, 'onClarificationReplied');
    on(BID_EVENT.BID_VALIDITY_CHANGE, 'onBidValidityChange');
    on(BID_EVENT.HALL_MESSAGE_NEW, 'onHallMessage');
    on(BID_EVENT.SCORES_SUBMITTED, 'onScoresSubmitted');
    on(BID_EVENT.DRAFT_SAVED, 'onDraftSaved');
  }

  const clearHeartbeatTimers = useCallback(() => {
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
      const isReconnect = hasConnectedOnce.current;
      hasConnectedOnce.current = true;
      attemptRef.current = 0;
      setConnection('connected');
      socket.emit('join:project', projectId);
      if (isReconnect) handlersRef.current.onReconnected?.();

      // Heartbeat: ping every 20s, expect pong within 10s
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

    socket.on('disconnect', () => {
      clearHeartbeatTimers();
      setConnection('disconnected');
      socketRef.current = null;
      if (manualClose.current) return;
      scheduleReconnect();
    });

    socket.on('connect_error', () => {
      setConnection('disconnected');
      scheduleReconnect();
    });

    // 绑定业务事件。每次 connect() 调用都会创建全新的 socket 实例，
    // 因此旧 socket 实例在 disconnect() 后会被 GC 回收，其上绑定的监听器也随之释放，
    // 不存在"重复绑定旧事件监听器"的问题。
    bindBusinessEvents(socket);
  }, [projectId]);

  const reconnectNow = useCallback(() => {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    clearHeartbeatTimers();
    attemptRef.current = 0;
    connect();
  }, [connect, clearHeartbeatTimers]);

  useEffect(() => {
    if (!projectId) return;
    connect();
    return () => {
      manualClose.current = true;
      clearHeartbeatTimers();
      if (socketRef.current) {
        socketRef.current.emit('leave:project', projectId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [projectId, connect, clearHeartbeatTimers]);

  return { connection, lastEventAt, reconnectNow };
}
