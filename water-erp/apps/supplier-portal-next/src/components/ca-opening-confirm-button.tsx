/* =================================================================
   ca-opening-confirm-button — 供应商确认唱标（dual-v3 · P7 强签，2026-10-14）
   办法§30「开标记录应当经投标人确认」的电子化动作：
   取服务端 canonical（v2·金额不进签）→ prepare → 盾 P7 签名 → opening-confirm。
   旧页断层修复：confirmOpening API 一直存在但 Next 大厅页从未接线。
   ================================================================= */
'use client';
import { useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { SpButton, SpDialog } from '@/components/ui';

export function CaOpeningConfirmButton({ projectId, onConfirmed }: {
  projectId: string;
  onConfirmed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function doConfirm() {
    if (!pin) return;
    setBusy(true);
    try {
      // ① 服务端重建 canonical（v2：openingRecordHash 钉内容，金额明文不进签）
      const payload = await supplierApi.getOpeningConfirmPayload(projectId);
      // ② 盾枚举 + PIN 登录
      setNote('正在读取 U盾…');
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书——请插入 SCCA CA U盾');
      await scca.loginScca(first.container, pin);
      // ③ prepare → 盾签 canonical → 提交
      setNote('盾签名确认记录（P7）…');
      const prep = await supplierApi.caPrepare(projectId, 'opening-confirm');
      const signP7 = await scca.signSccaP7(first.container, payload.canonical);
      setNote('提交确认…');
      await supplierApi.confirmOpeningV3(projectId, {
        operationId: prep.operationId, signatureFormat: 'scca-pkcs7-base64', signP7,
      });
      toast.success('唱标信息已确认（P7 电子签名）');
      setOpen(false);
      setPin('');
      onConfirmed?.();
    } catch (e: any) {
      toast.error(e?.message || '确认失败');
    } finally {
      setBusy(false);
      setNote('');
    }
  }

  return (
    <>
      <SpButton variant="primary" icon={CheckCircle2} onClick={() => setOpen(true)}>
        确认唱标
      </SpButton>
      <SpDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="确认唱标信息"
        width={420}
        footer={
          <>
            <SpButton variant="soft" disabled={busy} onClick={() => setOpen(false)}>取消</SpButton>
            <SpButton variant="primary" disabled={!pin || busy} loading={busy} onClick={doConfirm}>
              {busy ? (note || '确认中...') : '盾签名确认'}
            </SpButton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--fg-2)]">
          确认即表示本司认可唱标记录与投递内容一致。确认动作将以 SCCA U盾 P7 电子签名存档
          （签名覆盖记录快照哈希，防抵赖；开标后不可撤销）。
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium">U盾 PIN</label>
          <input
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
      </SpDialog>
    </>
  );
}
