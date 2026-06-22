'use client';

import { useRouter } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { useBidRealtime } from '@/contexts/bid-realtime-context';

export default function ProjectHeader() {
  const router = useRouter();
  const { project, isLoading, error, refetch } = useBidProjectContext();
  const { realtime } = useBidRealtime();

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={18} strokeWidth={1.5} className="text-[#e74c3c]" />
          <div>
            <p className="text-sm font-bold text-[#e74c3c]">{error}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refetch}
            className="rounded-xl border border-[#e74c3c] px-3 py-1.5 text-xs font-bold text-[#e74c3c] hover:bg-[#e74c3c]/10 transition"
          >
            重试
          </button>
          <button
            onClick={() => router.push('/bid')}
            className="rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
          >
            返回总览
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !project) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#edf2f7] bg-white px-5 py-4">
        <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        <span className="text-sm text-[#8a96aa]">加载项目信息…</span>
      </div>
    );
  }

  const stageLabel = STAGE_LABEL[project.stage] || project.stage;
  const stageColor = STAGE_COLOR[project.stage] || '#94a3b8';
  const projectCode = (project as any).projectCode || '';
  const supplierCount = (project as any)._count?.suppliers ?? (project as any).suppliers?.length ?? '—';
  const expertCount = (project as any)._count?.experts ?? (project as any).experts?.length ?? '—';

  return (
    <div className="rounded-2xl border border-[#edf2f7] bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center gap-4 min-w-0">
          <button
            onClick={() => router.push('/bid')}
            className="flex items-center gap-1 rounded-xl border border-[#e5ecf4] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition flex-shrink-0"
          >
            <ArrowLeft size={14} strokeWidth={1.5} />
            返回总览
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-[#18243a] truncate">
              {projectCode && (
                <span className="font-mono text-[#064ea2] mr-2">{projectCode}</span>
              )}
              {project.name}
            </h1>
            <div className="flex items-center gap-4 mt-1">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ color: stageColor, backgroundColor: `${stageColor}15` }}
              >
                {stageLabel}
              </span>
              <span className="text-xs text-[#8a96aa]">
                供应商：<span className="font-mono font-semibold text-[#18243a]">{supplierCount}</span>
              </span>
              <span className="text-xs text-[#8a96aa]">
                专家：<span className="font-mono font-semibold text-[#18243a]">{expertCount}</span>
              </span>
            </div>
          </div>
        </div>
        {realtime && (
          <ConnectionIndicator connection={realtime.connection} lastEventAt={realtime.lastEventAt} onReconnect={realtime.onReconnect} />
        )}
      </div>
    </div>
  );
}
