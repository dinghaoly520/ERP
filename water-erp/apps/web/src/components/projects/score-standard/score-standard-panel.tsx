'use client';

import { useEffect } from 'react';
import { ListChecks, X } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { ScoreStandardEditor } from './score-standard-editor';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  round?: number;
};

export function ScoreStandardPanel({ isOpen, onClose, project, round }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* ── 标题栏 ── */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'var(--stage-tender-soft)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <ListChecks size={17} style={{ color: 'var(--stage-tender)' }} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                评分标准编制
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
                {project.title} · {project.procurementMethod}
                {(round ?? 1) > 1 ? ` · 第 ${round} 轮` : ''}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-soft !p-2" title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* ── 主体 ── */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          style={{ background: 'oklch(0.975 0.012 258 / 0.32)' }}
        >
          <div className="mx-auto max-w-[1080px]">
            <ScoreStandardEditor project={project} round={round} variant="standalone" />
          </div>
        </div>
      </div>
    </div>
  );
}
