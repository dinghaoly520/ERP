'use client';

import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { STAGE_LABEL } from '@water-erp/shared';
import { api } from '@/lib/api';

interface ProjectData {
  id: string;
  name: string;
  projectCode: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  riskNote?: string;
  stage: string;
}

interface Props {
  open: boolean;
  project: ProjectData;
  onClose: () => void;
  onUpdated: () => void;
}

const METHODS = ['公开招标', '邀请招标', '谈判采购', '询价', '单一来源'];

/** Allowed next stages per current stage (mirrors bid-state.ts). */
const NEXT_STAGES: Record<string, string[]> = {
  DOWNLOAD: ['SUBMIT'],
  SUBMIT: ['OPENING'],
  OPENING: ['EVALUATING'],
  EVALUATING: ['ARCHIVED'],
  ARCHIVED: [],
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO/date string → datetime-local input value (YYYY-MM-DDTHH:mm, local timezone). */
function toLocalInput(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FIELD_LABEL =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]';

export default function EditProjectDialog({ open, project, onClose, onUpdated }: Props) {
  const [name, setName] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('公开招标');
  const [openTime, setOpenTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill fields whenever project changes
  useEffect(() => {
    if (project) {
      setName(project.name ?? '');
      setProcurementMethod(project.procurementMethod ?? '公开招标');
      setOpenTime(toLocalInput(project.openTime));
      setDeadline(toLocalInput(project.deadline));
      setRiskNote(project.riskNote ?? '');
      setError('');
    }
  }, [project]);

  if (!open) return null;

  const nextStages = NEXT_STAGES[project.stage] ?? [];
  const stageLabel = STAGE_LABEL[project.stage] ?? project.stage;

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('请输入项目名称'); return; }
    if (!openTime) { setError('请选择开标时间'); return; }
    if (!deadline) { setError('请选择截标时间'); return; }
    if (new Date(deadline) <= new Date(openTime)) { setError('截标时间必须晚于开标时间'); return; }

    setSubmitting(true);
    try {
      await api.patch(`/bid/projects/${project.id}`, {
        name: name.trim(),
        procurementMethod,
        openTime: new Date(openTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        riskNote: riskNote.trim() || undefined,
      });
      onUpdated();
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />

      <div className="bid-dialog relative mx-4 w-full max-w-[480px]" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 pb-4 pt-5">
          <h2 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">编辑项目</h2>
          <button onClick={onClose} className="neu-btn-xs" title="关闭"><X size={15} strokeWidth={1.7} /></button>
        </div>
        <div className="wb-section-rule" />

        {/* Project metadata bar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-3 text-[11px]">
          <span className="font-mono font-semibold tracking-wide text-[var(--muted-foreground)]">{project.projectCode}</span>
          <span className="bid-pill" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>{stageLabel}</span>
          {nextStages.length > 0 && (
            <span className="text-[var(--muted-foreground)]">
              可流转至 <span className="font-semibold text-[var(--accent-strong)]">{nextStages.map(s => STAGE_LABEL[s] ?? s).join(' / ')}</span>
            </span>
          )}
        </div>
        <div className="wb-section-rule" />

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={FIELD_LABEL}>
              项目名称 <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：2026年度水利工程材料采购"
              className="neu-input"
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>采购方式</label>
            <select
              value={procurementMethod}
              onChange={(e) => setProcurementMethod(e.target.value)}
              className="neu-select w-full"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={FIELD_LABEL}>
                开标时间 <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className="neu-input"
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>
                截标时间 <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="neu-input"
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL}>风险备注</label>
            <input
              value={riskNote}
              onChange={(e) => setRiskNote(e.target.value)}
              placeholder="选填"
              className="neu-input"
            />
          </div>

          {error && <div className="bid-alert">{error}</div>}
        </div>

        <div className="wb-section-rule" />

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <p className="text-[11px] text-[var(--muted-foreground)]">项目编号：{project.projectCode}</p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
            <button onClick={handleSubmit} disabled={submitting} className="neu-btn-primary !h-[38px]">
              <Save size={14} strokeWidth={2} />
              {submitting ? '保存中…' : '保存修改'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
