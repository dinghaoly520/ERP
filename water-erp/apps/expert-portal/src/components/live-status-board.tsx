'use client';

import { useState } from 'react';
import {
  ShieldCheck, Edit3, FileCheck, Radio, WifiOff,
} from 'lucide-react';
import type { ConnectionState, ExpertPresenceAggregatePayload } from '@water-erp/shared';

interface Props {
  connection: ConnectionState;
  lastEventAt: number | null;
  onReconnect: () => void;
  aggregate?: ExpertPresenceAggregatePayload | null;
  events: { time: number; label: string; icon: 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify' }[];
}

type EventIcon = 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify';

const eventIcons: Record<EventIcon, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  decrypt: Edit3,
  stage: Radio,
  signin: ShieldCheck,
  avoid: ShieldCheck,
  score: Edit3,
  report: FileCheck,
  clarify: Edit3,
};

/**
 * 紧凑单行状态条：连接 + 专家组签到/进度/确认 + 进度条。
 * 事件流收纳进浮动面板，按需展开，不再占用头部垂直空间。
 */
export function LiveStatusBoard({ connection, lastEventAt, onReconnect, aggregate, events }: Props) {
  const [showEvents, setShowEvents] = useState(false);

  const pillColor =
    connection === 'connected' ? 'var(--success)' :
    connection === 'reconnecting' ? 'var(--warning)' : 'var(--danger)';

  const label =
    connection === 'connected' ? '实时' :
    connection === 'reconnecting' ? '重连中' : '已断开';

  const tooltip =
    connection === 'connected'
      ? `实时连接 · 最近事件 ${lastEventAt ? new Date(lastEventAt).toLocaleTimeString('zh-CN') : '—'}`
      : connection === 'reconnecting'
      ? '重连中…'
      : '连接已断开';

  return (
    <div className="relative flex items-center gap-2.5">
      {/* 连接状态 pill */}
      {connection === 'disconnected' ? (
        <button onClick={onReconnect} title={tooltip} className="exp-pill !gap-1 !px-2 !py-0.5 !text-[10px]"
          style={{ '--c': 'var(--danger)' } as React.CSSProperties}>
          <WifiOff size={10} strokeWidth={1.8} /> {label}
        </button>
      ) : (
        <span title={tooltip} className="exp-pill !gap-1 !px-2 !py-0.5 !text-[10px]"
          style={{ '--c': pillColor } as React.CSSProperties}>
          <span className={`exp-pill-dot ${connection === 'reconnecting' ? 'animate-pulse' : ''}`} />
          {label}
        </span>
      )}

      {/* 专家组进度（单行紧凑） */}
      {aggregate && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-[oklch(0.6_0.04_258/0.2)]" />
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-[var(--muted-foreground)]" title="签到">
            <ShieldCheck size={10} strokeWidth={2} className="text-[var(--success)]" />
            <strong className="text-[var(--foreground)]">{aggregate.signedInCount}/{aggregate.totalExperts}</strong>
          </span>
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-[var(--muted-foreground)]" title="平均进度">
            <Edit3 size={10} strokeWidth={2} className="text-[var(--warning)]" />
            <strong className="text-[var(--foreground)]">{aggregate.averageProgressPercent}%</strong>
          </span>
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-[var(--muted-foreground)]" title="报告确认">
            <FileCheck size={10} strokeWidth={2} className="text-[var(--success)]" />
            <strong className="text-[var(--foreground)]">{aggregate.reportConfirmedCount}/{aggregate.totalExperts}</strong>
          </span>
          <div className="exp-bar w-16"
            role="progressbar" aria-valuenow={aggregate.averageProgressPercent} aria-valuemin={0} aria-valuemax={100}
            aria-label={`评审总进度 ${aggregate.averageProgressPercent}%`}>
            <i style={{ width: `${aggregate.averageProgressPercent}%` } as React.CSSProperties} />
          </div>
        </>
      )}

      {/* 事件流开关 */}
      {events.length > 0 && (
        <>
          <button
            onClick={() => setShowEvents(prev => !prev)}
            title="最近事件"
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--accent-strong)]"
            style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}
          >
            <Radio size={10} strokeWidth={2} /> {events.length}
          </button>
          {showEvents && (
            <div className="neu-card-static absolute right-0 top-full z-30 mt-2 w-72 space-y-1 rounded-xl p-3 shadow-lg">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">最近事件</span>
                <button onClick={() => setShowEvents(false)} className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">收起</button>
              </div>
              {events.slice(0, 8).map((e, i) => {
                const Icon = eventIcons[e.icon] ?? Radio;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                    <span className="w-10 shrink-0 text-[10px] tabular-nums opacity-70">
                      {new Date(e.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Icon size={11} strokeWidth={1.7} className="shrink-0 text-[var(--accent-strong)]" aria-hidden="true" />
                    <span className="truncate">{e.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
