/* =================================================================
   ca-clarification-sign-dialog — 评标澄清答复 P7 强签弹窗（2026-10-19）
   补齐 24de18a8 接线缺口：doReply 校验 pin 但页面从未渲染 PIN 输入框，
   dual-v3 供应商被 toast 要求输 PIN 却无处可输。
   弹窗模式（同 CaReceiptSignButton 构造）：
   PIN → canonical（服务端 payload）→ 盾枚举+PIN → prepare →
   signSccaP7 → submitClarificationReply v3 字段。
   ================================================================= */
'use client';
import { useEffect, useState } from 'react';
import { PenLine, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { bidApi } from '@/lib/api/bid';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { SpButton, SpDialog } from '@/components/ui';

export interface CaClarificationSignTarget {
  id: string;
  replyText: string;
  attachmentIds: string[];
}

export function CaClarificationSignDialog({ open, onClose, projectId, clarification, onSubmitted }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  clarification: CaClarificationSignTarget | null;
  onSubmitted?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // 每次打开重置——PIN 不在页面上常驻、不留存（不落盘）
  useEffect(() => {
    if (open) { setPin(''); setError(''); setNote(''); }
  }, [open]);

  function close() {
    if (!busy) onClose();
  }

  async function doSign() {
    if (!pin || !clarification) return;
    setBusy(true);
    setError('');
    try {
      // ① 服务端 canonical（含答复文本 + 附件哈希）
      setNote('正在读取 U盾…');
      const pl = await bidApi.getClarificationReplyPayload(projectId, clarification.id, {
        reply: clarification.replyText,
        attachmentIds: clarification.attachmentIds,
      });
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书——请插入 SCCA CA U盾');
      await scca.loginScca(first.container, pin);
      // ② prepare → 盾签 → ③ 提交（v3 分支要求 operationId+signP7）
      setNote('正在用 U盾签名澄清答复…');
      const prep = await supplierApi.caPrepare(projectId, 'clarification');
      const signP7 = await scca.signSccaP7(first.container, pl.payload);
      setNote('提交澄清答复…');
      await bidApi.submitClarificationReply(projectId, clarification.id, {
        reply: clarification.replyText,
        attachmentIds: clarification.attachmentIds,
        operationId: prep.operationId,
        signatureFormat: 'scca-pkcs7-base64',
        signP7,
      });
      toast.success('澄清答复已提交');
      onClose();
      onSubmitted?.();
    } catch (e: any) {
      setError(e?.message ?? '签署失败');
    } finally {
      setBusy(false);
      setNote('');
    }
  }

  return (
    <SpDialog
      open={open && !!clarification}
      onClose={close}
      title="SCCA CA 澄清答复签署"
      icon={PenLine}
      width={420}
      footer={
        <>
          <SpButton variant="soft" disabled={busy} onClick={close}>取消</SpButton>
          <SpButton variant="primary" disabled={!pin || busy} loading={busy} onClick={doSign}>
            {busy ? (note || '签署中...') : '盾签名并提交'}
          </SpButton>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--fg-2)]">
        澄清答复将使用贵司 U盾数字签名提交（答复与附件一并纳入签名），提交后不可修改。
      </p>
      <div className="mt-3">
        <label className="mb-1 block text-sm font-medium" htmlFor="ca-clar-pin">U盾 PIN</label>
        <input
          id="ca-clar-pin"
          data-testid="ca-clar-pin"
          data-dialog-initial-focus
          type="password"
          value={pin}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => setPin(e.target.value)}
          placeholder="请输入 U盾 PIN"
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
  );
}
