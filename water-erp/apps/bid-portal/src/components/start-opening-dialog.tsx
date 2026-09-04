'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → datetime-local 输入值 (YYYY-MM-DDTHH:mm，本地时区) */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 组建开标会话弹窗 —— 收集主持人/监督人（选填）/解密时间窗口后提交 StartOpeningDto。
 * Phase 3 起：:3005「按时开标」只推阶段（不建会话），会话在 :3007 开标大厅
 * 由主持人组建——同阶段（OPENING→OPENING）幂等调用 /open 写入会话。
 * 监督人选填：法律未强制开标现场必须有具名监督人（《招标投标法》第35/36条），
 * 填了则登记为监督人 / 线上监督责任人。 */
export default function StartOpeningDialog({ open, projectId, onClose, onStarted }: Props) {
  const [host, setHost] = useState('');
  const [supervisor, setSupervisor] = useState('');
  // 默认解密窗口：现在 ~ 现在 + 30 分钟
  const [decryptStart, setDecryptStart] = useState(() => toLocalInput(new Date()));
  const [decryptEnd, setDecryptEnd] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    setError('');
    if (!host.trim()) {
      setError('请填写主持人');
      return;
    }
    const start = new Date(decryptStart);
    const end = new Date(decryptEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('解密时间格式不正确');
      return;
    }
    if (end <= start) {
      setError('解密结束时间需晚于开始时间');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/bid/projects/${projectId}/open`, {
        host: host.trim(),
        // 监督人选填：留空则省略字段（DTO @IsNotEmpty 不接受空串）
        ...(supervisor.trim() ? { supervisor: supervisor.trim() } : {}),
        decryptWindowStart: start.toISOString(),
        decryptWindowEnd: end.toISOString(),
      });
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '组建开标会话失败');
    } finally {
      setSubmitting(false);
    }
  };

  const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bid-dialog relative mx-4 w-full max-w-[min(480px,92vw)]" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
          <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-[color:var(--foreground)]">
            组建开标会话
          </h3>
          <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭"><X size={15} /></button>
        </div>

        <hr className="wb-section-rule mx-6" />

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={labelCls}>主持人 <span className="text-[var(--danger)]">*</span></label>
            <input value={host} onChange={(e) => setHost(e.target.value)} className="neu-input" placeholder="请输入主持人姓名" autoFocus />
          </div>
          <div>
            <label className={labelCls}>监督人 <span className="font-normal normal-case text-[color:var(--muted-foreground)]">选填</span></label>
            <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} className="neu-input" placeholder="监督人姓名（可留空）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>解密开始</label>
              <input type="datetime-local" value={decryptStart} onChange={(e) => setDecryptStart(e.target.value)} className="neu-input font-mono" />
            </div>
            <div>
              <label className={labelCls}>解密结束</label>
              <input type="datetime-local" value={decryptEnd} onChange={(e) => setDecryptEnd(e.target.value)} className="neu-input font-mono" />
            </div>
          </div>
          {error && <div className="bid-alert">{error}</div>}
        </div>

        <hr className="wb-section-rule mx-6" />

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="text-[11px] text-[color:var(--muted-foreground)]">组建后即可解密 / 唱标（开标时间已由采购管理工作台确认）</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="neu-btn-primary !h-[38px] disabled:opacity-50">
              {submitting ? '组建中…' : '确认组建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
