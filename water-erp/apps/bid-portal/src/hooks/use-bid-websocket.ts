'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface WsHandlers {
  onDecrypt?: (data: { supplierId: string; decryptStatus: string; supplierName: string }) => void;
  onSupervisionLog?: (data: any) => void;
  onStageChange?: (data: { stage: string }) => void;
}

export function useBidWebSocket(projectId: string | undefined, handlers: WsHandlers) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const socket = io('http://localhost:4001/bid', { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:project', projectId);
    });

    if (handlers.onDecrypt) socket.on('decrypt:update', handlers.onDecrypt);
    if (handlers.onSupervisionLog) socket.on('supervision:log', handlers.onSupervisionLog);
    if (handlers.onStageChange) socket.on('stage:change', handlers.onStageChange);

    return () => {
      socket.emit('leave:project', projectId);
      socket.disconnect();
    };
  }, [projectId]);

  return socketRef;
}
