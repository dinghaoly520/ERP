'use client';

import type { ConnectionState } from '@water-erp/shared';
import { Wifi, WifiOff } from 'lucide-react';

interface Props {
  connection: ConnectionState;
  lastEventAt: number | null;
  onReconnect: () => void;
}

export function ConnectionIndicator({ connection, lastEventAt, onReconnect }: Props) {
  const dot =
    connection === 'connected' ? 'bg-[#11a874]' :
    connection === 'reconnecting' ? 'bg-[#f5a623] animate-pulse' : 'bg-[#e74c3c]';
  const label =
    connection === 'connected' ? '实时连接' :
    connection === 'reconnecting' ? '重连中…' : '已断开';
  const tooltip =
    connection === 'connected'
      ? `实时连接 · 最近事件 ${lastEventAt ? new Date(lastEventAt).toLocaleTimeString('zh-CN') : '—'}`
      : connection === 'reconnecting'
      ? '重连中…'
      : '连接已断开';

  if (connection === 'disconnected') {
    return (
      <button onClick={onReconnect} title={tooltip}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#e74c3c] bg-[#fef2f2] px-2.5 py-1 text-[11px] font-bold text-[#e74c3c] hover:bg-red-100 transition"
      >
        <WifiOff size={11} /> {label}
      </button>
    );
  }
  return (
    <span title={tooltip}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#e5ecf4] bg-white px-2.5 py-1 text-[11px] font-bold text-[#5a6d8a]"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
