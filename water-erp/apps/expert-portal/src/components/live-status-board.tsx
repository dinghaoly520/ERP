'use client';

import {
  ShieldCheck, Edit3, FileCheck, Radio, Users, WifiOff,
  Unlock, RefreshCw, CheckCircle, MessageSquare,
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
  decrypt: Unlock,
  stage: RefreshCw,
  signin: CheckCircle,
  avoid: ShieldCheck,
  score: Edit3,
  report: FileCheck,
  clarify: MessageSquare,
};

export function LiveStatusBoard({ connection, lastEventAt, onReconnect, aggregate, events }: Props) {
  const pillColor =
    connection === 'connected' ? 'var(--success)' :
    connection === 'reconnecting' ? 'var(--warning)' : 'var(--danger)';

  const label =
    connection === 'connected' ? '实时连接' :
    connection === 'reconnecting' ? '重连中…' : '已断开';

  const tooltip =
    connection === 'connected'
      ? `实时连接 · 最近事件 ${lastEventAt ? new Date(lastEventAt).toLocaleTimeString('zh-CN') : '—'}`
      : connection === 'reconnecting'
      ? '重连中…'
      : '连接已断开';

  return (
    <div className="space-y-3 text-xs">
      {/* 连接状态 pill */}
      <div className="flex items-center gap-3">
        {connection === 'disconnected' ? (
          <button onClick={onReconnect} title={tooltip} className="exp-pill !gap-1.5 !px-3 !py-1 !text-[11px]"
            style={{ '--c': 'var(--danger)' } as React.CSSProperties}>
            <WifiOff size={11} strokeWidth={1.8} /> {label}
          </button>
        ) : (
          <span title={tooltip} className="exp-pill !gap-1.5 !px-3 !py-1 !text-[11px]"
            style={{ '--c': pillColor } as React.CSSProperties}>
            <span className={`exp-pill-dot ${connection === 'reconnecting' ? 'animate-pulse' : ''}`} />
            {label}
          </span>
        )}
        {lastEventAt && (
          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{new Date(lastEventAt).toLocaleTimeString('zh-CN')}</span>
        )}
      </div>

      {/* 专家组在席汇总 — 仅里程碑，不含分数 */}
      {aggregate && (
        <div className="neu-card-static !rounded-[14px] space-y-1.5 p-3">
          <div className="flex items-center gap-2">
            <Users size={12} strokeWidth={1.5} className="text-[var(--muted-foreground)]" />
            <span className="font-semibold text-[var(--foreground)]">专家组进度</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <ShieldCheck size={10} className="text-[var(--success)]" />
              <strong className="tabular-nums">{aggregate.signedInCount}/{aggregate.totalExperts}</strong>
              <span className="text-[var(--muted-foreground)]">已签到</span>
            </span>
            <span className="flex items-center gap-1">
              <Edit3 size={10} className="text-[var(--warning)]" />
              <strong className="tabular-nums">{aggregate.averageProgressPercent}%</strong>
              <span className="text-[var(--muted-foreground)]">平均进度</span>
            </span>
            <span className="flex items-center gap-1">
              <FileCheck size={10} className="text-[var(--success)]" />
              <strong className="tabular-nums">{aggregate.reportConfirmedCount}/{aggregate.totalExperts}</strong>
              <span className="text-[var(--muted-foreground)]">报告确认</span>
            </span>
          </div>
          {/* 进度条 */}
          <div className="exp-bar"
            role="progressbar" aria-valuenow={aggregate.averageProgressPercent} aria-valuemin={0} aria-valuemax={100}
            aria-label={`评审总进度 ${aggregate.averageProgressPercent}%`}>
            <i style={{ width: `${aggregate.averageProgressPercent}%` } as React.CSSProperties} />
          </div>
        </div>
      )}

      {/* 事件流 — 最近 5 条，新→旧 */}
      {events.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            <Radio size={10} /> 最近事件
          </div>
          {events.slice(0, 5).map((e, i) => {
            const Icon = eventIcons[e.icon] ?? RefreshCw;
            return (
              <div key={i} className="flex items-center gap-1.5 pl-4 text-[11px] text-[var(--muted-foreground)]">
                <span className="w-12 shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)] opacity-70">
                  {new Date(e.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Icon size={11} strokeWidth={1.7} className="shrink-0 text-[var(--accent-strong)]" aria-hidden="true" />
                <span className="truncate">{e.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
