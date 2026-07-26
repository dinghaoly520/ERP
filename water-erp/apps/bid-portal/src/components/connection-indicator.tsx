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
    connection === 'connected' ? 'bg-[var(--success)]' :
    connection === 'reconnecting' ? 'bg-[var(--warning)] animate-pulse' : 'bg-[var(--danger)]';
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
      <button type="button" onClick={onReconnect} title={tooltip} className="neu-btn-xs is-danger">
        <WifiOff size={11} /> {label}
      </button>
    );
  }
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.985_0.006_258_/_0.9)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.8),2px_2px_5px_oklch(0.55_0.03_258_/_0.12),-1px_-1px_3px_oklch(1_0_0_/_0.9)]"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
