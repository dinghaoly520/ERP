'use client';

import { ShieldCheck, Edit3, FileCheck, Radio, Users, WifiOff } from 'lucide-react';
import type { ConnectionState, ExpertPresenceAggregatePayload } from '@water-erp/shared';

interface Props {
  connection: ConnectionState;
  lastEventAt: number | null;
  onReconnect: () => void;
  aggregate?: ExpertPresenceAggregatePayload | null;
  events: { time: number; label: string; icon: 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify' }[];
}

const eventIcons: Record<string, string> = { decrypt: '🔓', stage: '🔄', signin: '✅', avoid: '🛡️', score: '📝', report: '📋', clarify: '💬' };

export function LiveStatusBoard({ connection, lastEventAt, onReconnect, aggregate, events }: Props) {
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

  return (
    <div className="space-y-3 text-xs">
      {/* Connection pill — matching bid-portal ConnectionIndicator style */}
      <div className="flex items-center gap-3">
        {connection === 'disconnected' ? (
          <button onClick={onReconnect} title={tooltip}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e74c3c] bg-[#fef2f2] px-2.5 py-1 text-[11px] font-bold text-[#e74c3c] hover:bg-red-100 transition"
          >
            <WifiOff size={11} /> {label}
          </button>
        ) : (
          <span title={tooltip}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e5ecf4] bg-white px-2.5 py-1 text-[11px] font-bold text-[#5a6d8a]"
          >
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            {label}
          </span>
        )}
        {lastEventAt && (
          <span className="text-[10px] text-[#9aa9bb]">{new Date(lastEventAt).toLocaleTimeString('zh-CN')}</span>
        )}
      </div>

      {/* Aggregate presence bar — milestones only, no scores */}
      {aggregate && (
        <div className="bg-[#f7f9fc] rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Users size={12} strokeWidth={1.5} className="text-[#5a6d8a]" />
            <span className="font-semibold text-[#1a2332]">专家组进度</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <ShieldCheck size={10} className="text-[#11a874]" />
              <strong className="tabular-nums">{aggregate.signedInCount}/{aggregate.totalExperts}</strong>
              <span className="text-[#7b8da0]">已签到</span>
            </span>
            <span className="flex items-center gap-1">
              <Edit3 size={10} className="text-[#f5a623]" />
              <strong className="tabular-nums">{aggregate.averageProgressPercent}%</strong>
              <span className="text-[#7b8da0]">平均进度</span>
            </span>
            <span className="flex items-center gap-1">
              <FileCheck size={10} className="text-[#11a874]" />
              <strong className="tabular-nums">{aggregate.reportConfirmedCount}/{aggregate.totalExperts}</strong>
              <span className="text-[#7b8da0]">报告确认</span>
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-[#e8eef5] rounded-full overflow-hidden"
            role="progressbar" aria-valuenow={aggregate.averageProgressPercent} aria-valuemin={0} aria-valuemax={100}
            aria-label={`评审总进度 ${aggregate.averageProgressPercent}%`}>
            <div className="h-full bg-[#0b63ce] rounded-full transition-all duration-700"
              style={{ width: `${aggregate.averageProgressPercent}%` }} />
          </div>
        </div>
      )}

      {/* Event stream — most recent 5, newest first */}
      {events.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#7b8da0] uppercase tracking-wider">
            <Radio size={10} /> 最近事件
          </div>
          {events.slice(0, 5).map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-[#5a6d8a] pl-4">
              <span className="text-[10px] tabular-nums text-[#9aa9bb] w-12">
                {new Date(e.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="flex-shrink-0">{eventIcons[e.icon]}</span>
              <span className="truncate">{e.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
