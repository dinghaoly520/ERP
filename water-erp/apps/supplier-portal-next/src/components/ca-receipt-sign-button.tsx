/* =================================================================
   ca-receipt-sign-button — 供应商回执 P7 强签（阶段2 收尾，2026-10-15）
   A-101 防抵赖：对回执 canonical（含 revision/envelopeHash/serverSubmittedAt/
   receiptNo）盾签 P7 → signSubmissionReceipt v3 分支。
   弹窗模式（同 CaOpeningConfirmButton 构造）。
   ================================================================= */
'use client';
import { useState } from 'react';
import { PenLine, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { SpButton, SpDialog } from '@/components/ui';

export function CaReceiptSignButton({ projectId, submissionId, onSigned }: {
  projectId: string;
  submissionId: string;
  onSigned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function doSign() {
    if (!pin || !projectId || !submissionId) return;
    setBusy(true);
    setError('');
    try {
      // ① 服务端重建 canonical（含 revision/envelopeHash/serverSubmittedAt/receiptNo）
      const { canonical } = await supplierApi.getReceiptPayload(submissionId);
      // ② 盾枚举 + PIN
      setNote('正在读取 U盾…');
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书——请插入 SCCA CA U盾');
      await scca.loginScca(first.container, pin);
      // ③ prepare → 盾签 → 提交（回执 v3 分支要求 operationId+signP7）
      setNote('正在用 U盾签署回执…');
      const prep = await supplierApi.caPrepare(projectId, 'receipt');
      const signP7 = await scca.signSccaP7(first.container, canonical);
      setNote('提交回执签名…');
      await supplierApi.signReceiptV3(submissionId, {
        operationId: prep.operationId,
        signatureFormat: 'scca-pkcs7-base64',
        signP7,
      });
      toast.success('回执已签署');
      setOpen(false);
      setPin('');
      onSigned?.();
    } catch (e: any) {
      setError(e?.message ?? '签署失败');
    } finally {
      setBusy(false);
      setNote('');
    }
  }

  return (
    <>
      <SpButton variant="primary" icon={PenLine} disabled={busy} onClick={() => { setError(''); setOpen(true); }}>
        盾签回执
      </SpButton>
      <SpDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="SCCA CA 回执签署"
        width={420}
        footer={
          <>
            <SpButton variant="soft" disabled={busy} onClick={() => setOpen(false)}>取消</SpButton>
            <SpButton variant="primary" disabled={!pin || busy} loading={busy} onClick={doSign}>
              {busy ? (note || '签署中...') : '盾签名'}
            </SpButton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--fg-2)]">
          对投标回执进行 P7 电子签名（含报价承诺哈希、递交时间、回执编号），签署后不可撤销。
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium">U盾 PIN</label>
          <input
            type="password" value={pin} autoComplete="off" disabled={busy}
            onChange={(e) => setPin(e.target.value)} placeholder="请输入 U盾 PIN"
            className="neu-input w-full"
          />
        </div>
        {busy && (
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-3)]">
            <LoaderCircle size={12} className="animate-spin" />{note || '处理中…'}
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs" style={{ color: 'var(--danger, #c0392b)' }} role="alert">{error}</div>
        )}
      </SpDialog>
    </>
  );
}
