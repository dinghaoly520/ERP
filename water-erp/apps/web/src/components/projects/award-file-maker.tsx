'use client';

import { useEffect, useState } from 'react';
import { Mail, Trophy, X } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { mapProcurementMethodToTenderType } from '@/lib/tender-write/procurement-method-map';
import { buildPrefillFromProject } from '@/lib/tender-write/prefill-from-project';
import type { ReadyTenderDocumentType, ReadyTenderDraft } from '@/lib/types/tender-write';
import { AnnouncementPublishWizard } from './announcement-publish-wizard';
import { NotificationLetterDialog } from '@/components/tender-write/notification-letter-dialog';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  onPublished: () => void;
};

type Pick = 'winning_bid' | 'notification';

export function AwardFileMaker({ isOpen, onClose, project, onPublished }: Props) {
  const [picked, setPicked] = useState<Pick | null>(null);

  const tenderType: ReadyTenderDocumentType | null = project
    ? mapProcurementMethodToTenderType(project.procurementMethod)
    : null;
  const [tenderDraft, setTenderDraft] = useState<ReadyTenderDraft | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开时构造预填数据 / 关闭时重置，符合模态惯例 */
  useEffect(() => {
    if (!isOpen || !project || !tenderType) {
      setTenderDraft(null);
      return;
    }
    setTenderDraft(buildPrefillFromProject(project, tenderType) as ReadyTenderDraft);
  }, [isOpen, project, tenderType]);

  useEffect(() => {
    if (!isOpen) {
      setPicked(null);
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (picked) setPicked(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, picked]);

  if (!isOpen) return null;

  if (picked === 'notification' && tenderType && tenderDraft) {
    return (
      <NotificationLetterDialog
        isOpen
        tenderType={tenderType}
        tenderDraft={tenderDraft}
        onClose={() => setPicked(null)}
      />
    );
  }
  if (picked === 'winning_bid') {
    return (
      <AnnouncementPublishWizard
        isOpen
        project={project}
        onPublished={() => { onPublished(); setPicked(null); }}
        onClose={() => setPicked(null)}
        initialCategory="winning_bid"
      />
    );
  }

  // 选择器（流标公告已移至开标确认面板的「流标」按钮，定标阶段不再处理流标）
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 w-full max-w-[560px] rounded-[24px] p-6"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.96), oklch(0.99 0.004 258 / 0.66))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--foreground)]">文件制作</div>
            <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">选择需要制作的定标文件类型</div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs"><X size={16} /></button>
        </div>

        <div className="mt-4 space-y-2.5">
          <SelectorCard
            icon={<Trophy size={18} />}
            accent="var(--success)"
            accentSoft="color-mix(in oklch, var(--success) 14%, transparent)"
            title="中标公告"
            desc="公示中标结果，编写完成后发布到信息公告中心"
            onClick={() => setPicked('winning_bid')}
          />
          <SelectorCard
            icon={<Mail size={18} />}
            accent="var(--accent)"
            accentSoft="color-mix(in oklch, var(--accent) 14%, transparent)"
            title="中标通知书"
            desc="上传定标审批表 → 确认信息 → 导出通知书与台账"
            onClick={() => setPicked('notification')}
          />
        </div>
      </div>
    </div>
  );
}

function SelectorCard({
  icon, title, desc, accent, accentSoft, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent: string;
  accentSoft: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="neu-card group flex w-full items-center gap-3 rounded-[16px] px-4 py-3.5 text-left"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
        style={{ background: accentSoft, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
      >
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">{desc}</div>
      </div>
    </button>
  );
}
