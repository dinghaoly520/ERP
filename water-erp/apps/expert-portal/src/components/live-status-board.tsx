'use client';

import { ShieldCheck, Edit3, FileCheck, Clock, Radio, Users, Zap } from 'lucide-react';
import type { ConnectionState, ExpertPresenceAggregatePayload, DecryptStatusPayload, StageChangePayload, ClarificationCreatedPayload, ClarificationRepliedPayload } from '@water-erp/shared';

interface Props {
  connection: ConnectionState;
  lastEventAt: number | null;
  onReconnect: () => void;
  aggregate?: ExpertPresenceAggregatePayload | null;
  events: { time: number; label: string; icon: 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify' }[];
}

const dotColor = { connected: 'bg-[#11a874]', reconnecting: 'bg-[#f5a623] animate-pulse', disconnected: 'bg-[#e74c3c]' } as const;
const eventIcons = { decrypt: '🔓', stage: '🔄', signin: '✅', avoid: '🛡️', score: '📝', report: '📋', clarify: '💬' };

export function LiveStatusBoard({ connection, lastEventAt, onReconnect, aggregate, events }: Props) {
  return (
    <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-4 space-y-3 text-xs">
      {/* Connection row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dotColor[connection]}`} />
          <span className="font-bold text-[oklch(0.18_0.012_265)]">实时状态</span>
        </div>
        <div className="flex items-center gap-2">
          {lastEventAt && <span className="text-[10px] text-[oklch(0.62_0.008_264)]">{new Date(lastEventAt).toLocaleTimeString('zh-CN')}</span>}
          {connection === 'disconnected' && (
            <button onClick={onReconnect} className="text-[10px] font-bold text-[#e74c3c] hover:underline">重连</button>
          )}
        </div>
      </div>

      {/* Aggregate presence bar — ONLY milestones, ZERO scores */}
      {aggregate && (
        <div className="bg-[oklch(0.98_0.005_264)] rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Users size={12} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)]" />
            <span className="font-semibold text-[oklch(0.18_0.012_265)]">专家组进度</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><ShieldCheck size={10} /> <strong className="tabular-nums">{aggregate.signedInCount}/{aggregate.totalExperts}</strong> 已签到</span>
            <span className="flex items-center gap-1"><Edit3 size={10} /> <strong className="tabular-nums">{aggregate.averageProgressPercent}%</strong> 平均进度</span>
            <span className="flex items-center gap-1"><FileCheck size={10} /> <strong className="tabular-nums">{aggregate.reportConfirmedCount}/{aggregate.totalExperts}</strong> 报告确认</span>
          </div>
          {/* Progress bar: average */}
          <div className="h-1.5 bg-[oklch(0.94_0.004_264)] rounded-full overflow-hidden">
            <div className="h-full bg-[oklch(0.42_0.14_260)] rounded-full transition-all duration-700"
              style={{ width: `${aggregate.averageProgressPercent}%` }} />
          </div>
        </div>
      )}

      {/* Event stream — most recent 5, newest first */}
      {events.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider">
            <Radio size={10} /> 最近事件
          </div>
          {events.slice(0, 5).map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-[oklch(0.55_0.01_264)] pl-4">
              <span className="text-[10px] tabular-nums text-[oklch(0.72_0.008_264)] w-12">{new Date(e.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex-shrink-0">{eventIcons[e.icon]}</span>
              <span className="truncate">{e.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Disconnected banner */}
      {connection !== 'connected' && (
        <div className={`p-2 rounded-lg text-[11px] font-bold ${connection === 'reconnecting' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
          {connection === 'reconnecting' ? '⏳ 正在重连…' : '⚠️ 实时连接已断开'}
        </div>
      )}
    </div>
  );
}
