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
  const attemptRef = useRef(0);
  const manualClose = useRef(false);
  handlersRef.current = handlers;

  const clearTimers = () => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
  };

  const connect = useCallback(() => {
    if (!projectId || socketRef.current?.connected) return;
    manualClose.current = false;
    setConnection('reconnecting');
    const socket = io(wsUrl(), { withCredentials: true, reconnection: false, timeout: 10000 });
    socketRef.current = socket;

    socket.on('connect', () => {
      attemptRef.current = 0;
      setConnection('connected');
      socket.emit('join:project', projectId);
    });

    const scheduleReconnect = () => {
      if (manualClose.current || !projectId) return;
      const delays = [1000, 2000, 5000, 10000];
      attemptRef.current = Math.min(attemptRef.current + 1, 10);
      setConnection('reconnecting');
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => { socketRef.current?.disconnect(); socketRef.current = null; connect(); },
        delays[Math.min(attemptRef.current - 1, delays.length - 1)]);
    };

    socket.on('disconnect', () => { clearTimers(); setConnection('disconnected'); socketRef.current = null; if (!manualClose.current) scheduleReconnect(); });
    socket.on('connect_error', () => { setConnection('disconnected'); scheduleReconnect(); });

    const on = (ev: string, fn: any) => socket.on(ev, (d: any) => { if (fn) { setLastEventAt(Date.now()); fn(d); } });
    on('expert:presence:aggregate', handlersRef.current.onAggregatePresence);
    on('decrypt:status', handlersRef.current.onDecryptStatus);
    on('stage:change', handlersRef.current.onStageChange);
    on('clarification:created', handlersRef.current.onClarificationCreated);
    on('clarification:replied', handlersRef.current.onClarificationReplied);
  }, [projectId]);

  const reconnectNow = useCallback(() => { socketRef.current?.disconnect(); socketRef.current = null; clearTimers(); attemptRef.current = 0; connect(); }, [connect]);

  useEffect(() => { if (!projectId) return; connect(); return () => { manualClose.current = true; clearTimers(); socketRef.current?.disconnect(); socketRef.current = null; }; }, [projectId, connect]);

  return { connection, lastEventAt, reconnectNow };
}
