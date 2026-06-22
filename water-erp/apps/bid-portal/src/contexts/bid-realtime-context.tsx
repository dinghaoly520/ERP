'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import type { ConnectionState } from '@water-erp/shared';

export interface RealtimeSnapshot {
  connection: ConnectionState;
  lastEventAt: number | null;
  onReconnect: () => void;
}

interface BidRealtimeContextValue {
  realtime: RealtimeSnapshot | null;
  setRealtime: (r: RealtimeSnapshot | null) => void;
}

const BidRealtimeContext = createContext<BidRealtimeContextValue>({
  realtime: null,
  setRealtime: () => {},
});

export function useBidRealtime() {
  return useContext(BidRealtimeContext);
}

/**
 * 在项目工作区共享"当前活动 tab 的实时连接状态"，供项目头部指示器渲染。
 * 各 tab 页各自持有 WebSocket（逻辑不变），仅把连接状态镜像上报到此 context。
 */
export function BidRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [realtime, setRealtime] = useState<RealtimeSnapshot | null>(null);
  return (
    <BidRealtimeContext.Provider value={{ realtime, setRealtime }}>
      {children}
    </BidRealtimeContext.Provider>
  );
}

/**
 * 由拥有 WebSocket 连接的 tab 页调用 —— 把当前连接状态上报到共享 context。
 * tab 卸载时自动清空，避免离场后残留陈旧状态。
 */
export function useReportRealtime(
  connection: ConnectionState,
  lastEventAt: number | null,
  onReconnect: () => void,
) {
  const { setRealtime } = useBidRealtime();
  useEffect(() => {
    setRealtime({ connection, lastEventAt, onReconnect });
  }, [connection, lastEventAt, onReconnect, setRealtime]);
  // 仅在卸载时清空，避免每次状态变更都先置空造成闪烁
  useEffect(() => () => setRealtime(null), [setRealtime]);
}
