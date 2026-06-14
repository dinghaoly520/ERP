'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '询价', '单一来源'];

export default function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('公开招标');
  const [openTime, setOpenTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('请输入项目名称'); return; }
    if (!openTime) { setError('请选择开标时间'); return; }
    if (!deadline) { setError('请选择截标时间'); return; }
    if (new Date(deadline) <= new Date(openTime)) { setError('截标时间必须晚于开标时间'); return; }

    setSubmitting(true);
    try {
      const { api } = await import('@/lib/api');
      await api.post('/bid/projects', {
        name: name.trim(),
        procurementMethod,
        openTime: new Date(openTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        riskNote: riskNote.trim() || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[480px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            创建招标项目
          </h2>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              项目名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
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
              onChange={e => setProcurementMethod(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
            >
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
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
                onChange={e => setOpenTime(e.target.value)}
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
                onChange={e => setDeadline(e.target.value)}
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
              onChange={e => setRiskNote(e.target.value)}
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
          <p className="text-[11px] text-[oklch(0.62_0.008_264)]">项目编号将自动生成（格式：BID-时间戳）</p>
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
              <Plus size={13} strokeWidth={2} />
              {submitting ? '创建中…' : '确认创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
