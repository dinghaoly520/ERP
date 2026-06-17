'use client';

import { useState } from 'react';
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

/** 启动开标弹窗 —— 收集主持人/监督人/解密时间窗口后提交 StartOpeningDto。 */
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
    if (!host.trim() || !supervisor.trim()) {
      setError('请填写主持人与监督人');
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
        supervisor: supervisor.trim(),
        decryptWindowStart: start.toISOString(),
        decryptWindowEnd: end.toISOString(),
      });
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动开标失败');
    } finally {
      setSubmitting(false);
    }
  };

  const labelCls = 'block text-[11px] uppercase tracking-wider text-[oklch(0.55_0.01_264)] mb-1.5';
  const inputCls =
    'w-full border border-[oklch(0.88_0.008_264)] px-3 py-2 text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight focus:outline-none focus:border-[oklch(0.42_0.14_260)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(15,18,28,0.45)' }}>
      <div className="glass-card glass-card-deeper glass-card-blue w-full max-w-md mx-4 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            启动开标
          </h3>
          <button onClick={onClose} className="text-[12px] text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] tracking-tight">取消</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>主持人 <span className="text-[oklch(0.50_0.18_22)]">*</span></label>
            <input value={host} onChange={(e) => setHost(e.target.value)} className={inputCls} placeholder="如：采购中心-李主任" autoFocus />
          </div>
          <div>
            <label className={labelCls}>监督人 <span className="text-[oklch(0.50_0.18_22)]">*</span></label>
            <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} className={inputCls} placeholder="如：纪检监督-周老师" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>解密开始</label>
              <input type="datetime-local" value={decryptStart} onChange={(e) => setDecryptStart(e.target.value)} className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>解密结束</label>
              <input type="datetime-local" value={decryptEnd} onChange={(e) => setDecryptEnd(e.target.value)} className={`${inputCls} font-mono`} />
            </div>
          </div>
          {error && <div className="text-[12px] text-[oklch(0.50_0.18_22)] tracking-tight">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <span className="text-[11px] text-[oklch(0.62_0.008_264)] tracking-tight">启动后项目进入开标阶段</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[12px] text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] tracking-tight">取消</button>
            <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
              {submitting ? '启动中…' : '确认启动'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
