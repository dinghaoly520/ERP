'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const METHODS = ['公开招标', '邀请招标', '谈判采购', '询价', '单一来源'];

const FIELD_LABEL =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]';

export default function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('公开招标');
  const [openTime, setOpenTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [qualityRequirement, setQualityRequirement] = useState('');
  const [bondRequired, setBondRequired] = useState(false);
  const [bondAmount, setBondAmount] = useState('');
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
        qualityRequirement: qualityRequirement.trim() || undefined,
        bondRequired,
        bondAmount: bondAmount ? Number(bondAmount) : undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message || '创建失败');
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
          <h2 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">创建招标项目</h2>
          <button onClick={onClose} className="neu-btn-xs" title="关闭"><X size={15} strokeWidth={1.7} /></button>
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
              onChange={e => setName(e.target.value)}
              placeholder="例：2026年度水利工程材料采购"
              className="neu-input"
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>采购方式</label>
            <select
              value={procurementMethod}
              onChange={e => setProcurementMethod(e.target.value)}
              className="neu-select w-full"
            >
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
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
                onChange={e => setOpenTime(e.target.value)}
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
                onChange={e => setDeadline(e.target.value)}
                className="neu-input"
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL}>风险备注</label>
            <input
              value={riskNote}
              onChange={e => setRiskNote(e.target.value)}
              placeholder="选填"
              className="neu-input"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--foreground)]">质量目标 / 标准</label>
            <input
              value={qualityRequirement}
              onChange={e => setQualityRequirement(e.target.value)}
              className="neu-input"
              placeholder="如 合格，符合 GB50300 验收标准（项目级统一，唱标带出）"
            />

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={bondRequired}
                onChange={e => setBondRequired(e.target.checked)}
                className="neu-checkbox"
              />
              要求投标保证金
            </label>
            {bondRequired && (
              <div className="mt-2">
                <label className="text-xs font-semibold text-[var(--muted-foreground)]">保证金金额（元，仅记录，不严格校验）</label>
                <input
                  value={bondAmount}
                  onChange={e => setBondAmount(e.target.value)}
                  className="neu-input mt-1 font-mono"
                  placeholder="如 200000"
                />
              </div>
            )}
          </div>

          {error && <div className="bid-alert">{error}</div>}
        </div>

        <div className="wb-section-rule" />

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <p className="text-[11px] text-[var(--muted-foreground)]">项目编号将自动生成（格式：BID-时间戳）</p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
            <button onClick={handleSubmit} disabled={submitting} className="neu-btn-primary !h-[38px]">
              <Plus size={14} strokeWidth={2} />
              {submitting ? '创建中…' : '确认创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
