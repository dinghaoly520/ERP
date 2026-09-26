'use client';

import { Check, FileText } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/components/workbench';
import { getFileKind } from '../file-preview-pane';
import type { ProjectManagementAttachment } from '@/lib/types/project-management';

type Props = {
  open: boolean;
  /** 该轮「采购文件」步骤的全部附件（候选提取源） */
  candidates: ProjectManagementAttachment[];
  onClose: () => void;
  /** 选定后回调（attachmentId）——由调用方带着源发起提取 */
  onPick: (attachmentId: string, fileName: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** AI 提取源选择（2026-09-26 用户裁定）：「采购文件」步骤有多个文件时，
 *  询问用户提取哪一个（导出 docx / 手动上传的盖章扫描件等并列可选）。 */
export function ExtractSourcePickerDialog({ open, candidates, onClose, onPick }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="请选择 AI 提取源文件"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">取消</button>
          <button
            onClick={() => {
              const c = candidates.find((x) => x.id === picked);
              if (c?.id) onPick(c.id, c.fileName);
            }}
            disabled={!picked}
            className="neu-btn-primary !h-[38px] !text-xs"
          >
            开始提取
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-foreground)]">
        本步骤已上传多个文件——请选择本次 AI 提取得分点所依据的采购文件。
      </p>
      <div className="space-y-2">
        {candidates.map((c) => {
          const kind = getFileKind(c.fileName);
          const active = picked === c.id;
          return (
            <button
              key={c.objectKey}
              type="button"
              onClick={() => setPicked(c.id ?? null)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]'
                  : 'border-[oklch(0.9_0.005_264)] hover:bg-[oklch(0.975_0.003_265)]'
              }`}
            >
              <FileText size={16} className={kind === 'other' ? 'text-[var(--muted-foreground)]' : 'text-[var(--accent)]'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--foreground)]">{c.fileName}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                  {c.mimeType} · {formatSize(c.fileSize)}
                  {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleString('zh-CN')}` : ''}
                </span>
              </span>
              {active && <Check size={15} className="shrink-0 text-[var(--accent)]" />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
