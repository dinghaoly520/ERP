'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ConnectionState, ExpertPresenceAggregatePayload, DecryptStatusPayload, StageChangePayload, ClarificationCreatedPayload, ClarificationRepliedPayload } from '@water-erp/shared';

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return 'http://localhost:4001/bid';
}

interface Handlers {
  onAggregatePresence?: (d: ExpertPresenceAggregatePayload) => void;
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onClarificationCreated?: (d: ClarificationCreatedPayload) => void;
  onClarificationReplied?: (d: ClarificationRepliedPayload) => void;
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
    on('expert:presence:aggregate', h.current.onAggregatePresence);
    on('decrypt:status', h.current.onDecryptStatus);
    on('stage:change', h.current.onStageChange);
    on('clarification:created', h.current.onClarificationCreated);
    on('clarification:replied', h.current.onClarificationReplied);
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

  return { connection, lastEventAt, reconnectNow };
}
