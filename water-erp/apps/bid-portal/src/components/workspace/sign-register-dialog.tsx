'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { registerSign, type SignPacketExpertRow, type SignPacketResponse } from '@/lib/api/sign-packet';

type StatusChoice = 'SIGNED' | 'REFUSED_DISSENT' | 'DEEMED_AGREED';

export default function SignRegisterDialog({
  projectId,
  expert,
  onClose,
  onDone,
}: {
  projectId: string;
  expert: SignPacketExpertRow;
  onClose: () => void;
  onDone: (res: SignPacketResponse) => void;
}) {
  const [status, setStatus] = useState<StatusChoice>(expert.signStatus === 'PENDING' ? 'SIGNED' : (expert.signStatus as StatusChoice));
  const [opinion, setOpinion] = useState(expert.dissentingOpinion ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    // §43 前端预检（服务端仍强制）：拒绝必须陈述不同意见
    if (status === 'REFUSED_DISSENT' && !opinion.trim()) {
      setError('拒绝签字须书面陈述不同意见；拒绝签字且不陈述理由的，视为同意评标结论');
      return;
    }
    setBusy('submit');
    try {
      const res = await registerSign(projectId, expert.expertId, {
        status,
        dissentingOpinion: opinion.trim() || undefined,
      });
      onDone(res);
    } catch (e: any) {
      setError(e?.message ?? '登记失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bid-overlay" onClick={onClose}>
      <div className="bid-overlay-backdrop" />
      <div
        className="bid-dialog relative mx-4 w-full max-w-[min(480px,92vw)]"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pb-4 pt-5">
          <p className="text-sm font-semibold text-[var(--foreground)]">签字登记 — {expert.name}（{expert.role}）</p>
          <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭"><X size={16} /></button>
        </div>
        <hr className="wb-section-rule mx-6" />

        <div className="space-y-4 px-6 py-5">
          {error && <div className="bid-alert bid-alert--danger">{error}</div>}

          {/* 三态选择 */}
          <div className="grid grid-cols-3 gap-2">
            {([
              ['SIGNED', '已签字'],
              ['REFUSED_DISSENT', '拒绝·附不同意见'],
              ['DEEMED_AGREED', '视为同意'],
            ] as Array<[StatusChoice, string]>).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatus(v)}
                className="sign-choice rounded-xl px-2 py-2.5 text-xs font-semibold"
                data-selected={status === v ? 'true' : 'false'}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {status === 'REFUSED_DISSENT' && '法条：拒绝签字且不陈述理由的，视为同意评标结论。请填写书面不同意见与理由。'}
            {status === 'REFUSED_DISSENT' && <span className="block text-[var(--accent-strong)]">请让专家在签字包《不同意见书》页（附件末页模板）本人手写并签名；扫描件经「回传签字扫描件」上传（文件名含专家名）。</span>}
            {status === 'DEEMED_AGREED' && '记录该专家拒绝签字且未陈述理由，依法视为同意评标结论。'}
            {status === 'SIGNED' && '已签字；如附书面不同意见可一并填写（签字与不同意见可并存）。'}
          </p>

          {/* 不同意见（SIGNED 可选 / REFUSED_DISSENT 必填 / DEEMED_AGREED 隐藏） */}
          {status !== 'DEEMED_AGREED' && (
            <div className="space-y-2">
              <textarea
                value={opinion}
                onChange={(e) => setOpinion(e.target.value)}
                placeholder={status === 'REFUSED_DISSENT' ? '书面不同意见（必填）' : '书面不同意见（可选）'}
                rows={5}
                className="workbench-input w-full resize-none"
              />
            </div>
          )}
        </div>

        <hr className="wb-section-rule mx-6" />
        <div className="flex justify-end gap-2 px-6 py-4">
          <button type="button" onClick={onClose} className="neu-btn-soft !h-[36px] !text-xs">取消</button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void submit()}
            className="neu-btn-primary !h-[36px] !text-xs disabled:opacity-40"
          >
            {busy === 'submit' ? <Loader2 size={13} className="animate-spin" /> : null}
            确认登记
          </button>
        </div>
      </div>
    </div>
  );
}
