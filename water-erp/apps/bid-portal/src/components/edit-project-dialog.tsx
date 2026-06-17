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

const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '询价', '单一来源'];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="glass-card glass-card-deeper glass-card-blue w-full max-w-[480px] shadow-sm rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2
            className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
          >
            编辑项目
          </h2>
          <button
            onClick={onClose}
            className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Project metadata bar */}
        <div className="px-6 py-3 border-b border-[oklch(0.91_0.006_264)] flex items-center gap-4 text-[11px]">
          <span className="text-[oklch(0.55_0.01_264)] uppercase tracking-wider font-semibold">
            {project.projectCode}
          </span>
          <span className="text-[oklch(0.62_0.008_264)]">|</span>
          <span className="text-[oklch(0.55_0.01_264)] uppercase tracking-wider font-semibold">
            当前阶段：
          </span>
          <span className="text-[oklch(0.30_0.08_250)] font-semibold tracking-tight">
            {stageLabel}
          </span>
          {nextStages.length > 0 && (
            <>
              <span className="text-[oklch(0.62_0.008_264)]">|</span>
              <span className="text-[oklch(0.55_0.01_264)] uppercase tracking-wider font-semibold">
                可流转至：
              </span>
              {nextStages.map((s) => (
                <span
                  key={s}
                  className="text-[oklch(0.42_0.14_260)] font-medium tracking-tight"
                >
                  {STAGE_LABEL[s] ?? s}
                </span>
              ))}
            </>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              项目名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：2026年度水利工程材料采购"
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
                placeholder:text-[oklch(0.72_0.008_264)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              采购方式
            </label>
            <select
              value={procurementMethod}
              onChange={(e) => setProcurementMethod(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
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
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                开标时间 <span className="text-[oklch(0.50_0.18_22)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                  focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                截标时间 <span className="text-[oklch(0.50_0.18_22)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                  focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              风险备注
            </label>
            <input
              value={riskNote}
              onChange={(e) => setRiskNote(e.target.value)}
              placeholder="选填"
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
                placeholder:text-[oklch(0.72_0.008_264)]"
            />
          </div>

          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <p className="text-[11px] text-[oklch(0.62_0.008_264)]">
            项目编号：{project.projectCode}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight
                hover:text-[oklch(0.18_0.012_265)] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px]
                font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
            >
              <Save size={13} strokeWidth={2} />
              {submitting ? '保存中…' : '保存修改'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
