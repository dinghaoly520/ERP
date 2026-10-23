/* =================================================================
   ca-opening-decrypt-card — dual-v3 开标解密（阶段2 Task12 · 2026-10-14 重构）
   交互（用户裁定）：按钮触发 → 弹窗输 PIN → 执行；成功后由父页卸载。
   流程：取包（opening-package v3）→ 逐角色下载 C_inner → 盾 unwrapKey(kself P7)
        → DEK_S → SM4 解密 → sealedFields 解出 fields+nonce → P7 解密证明
        → decrypt-upload。
   样式：SpDialog/SpButton 对齐大厅既有弹窗体系（与确认唱标按钮同构）。
   ================================================================= */
'use client';
import { useState } from 'react';
import { LockOpen, LoaderCircle, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { assertSecureContext, buildDecryptProofCanonical, pickShieldByFingerprint } from '@/utils/dual-v3-client';
import { canonicalJson, computeV3FieldsCommit, sha256Hex, sm4Decrypt } from '@water-erp/ukey';
import type { V3Fields, V3Role } from '@water-erp/ukey';
import { SpButton, SpDialog } from '@/components/ui';

interface PkgFile { role: V3Role; innerAsset: string; downloadUrl: string; innerSha256: string; innerBytes: number; kself: { format: string; recipientCertFingerprint: string; value: string } }

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

async function fetchCInner(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'include', headers: { 'X-Portal': 'supplier' } });
  if (!res.ok) throw new Error(`C_inner 下载失败(${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function CaOpeningDecryptCard({ projectId, onDecrypted, done }: {
  projectId: string;
  onDecrypted?: (outcome: { decryptStatus: string }) => void;
  /** 已解密：显示禁用态按钮（状态可见性优于隐藏——2026-10-14 用户裁定） */
  done?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  if (done) {
    return (
      <SpButton variant="soft" icon={CircleCheck} disabled
        className="opacity-60">
        已解密
      </SpButton>
    );
  }

  async function start() {
    if (!pin) return;
    assertSecureContext(); // LAN http 下 sha256Hex（解密证明哈希）首触即裸 TypeError——先给指引
    setBusy(true);
    setError('');
    try {
      setNote('正在获取开标解密包…');
      const pkg = await supplierApi.getOpeningPackage(projectId);
      if (!pkg.files?.length || !pkg.sealedFields) throw new Error('解密包未就绪（外层尚未解密）');

      setNote('正在读取 U盾…');
      const certs = await scca.listSccaCerts();
      // 按信封收件证书指纹选盾——多盾并插/换错盾当场点名，不再盲取 certs[0]（2026-10-22 世纪远景实录）
      const shield = await pickShieldByFingerprint(certs, pkg.files?.[0]?.kself?.recipientCertFingerprint);
      await scca.loginScca(shield.container, pin);

      const plainByRole: Partial<Record<V3Role, Uint8Array>> = {};
      for (const f of pkg.files as PkgFile[]) {
        setNote(`正在解密 ${f.role}（${(f.innerBytes / 1024 / 1024).toFixed(1)}MB）…`);
        const cInner = await fetchCInner(f.downloadUrl);
        const dekJson = await scca.unwrapSccaKey(shield.container, f.kself.value);
        const dek = JSON.parse(dekJson);
        const plainHex = sm4Decrypt(dek.k, dek.iv, bytesToHex(cInner));
        plainByRole[f.role] = hexToBytes(plainHex);
      }

      setNote('正在揭示唱标字段…');
      const dekFJson = await scca.unwrapSccaKey(shield.container, pkg.sealedFields.kself.value);
      const dekF = JSON.parse(dekFJson);
      const sealedPlain = new TextDecoder().decode(hexToBytes(sm4Decrypt(dekF.k, dekF.iv, pkg.sealedFields.cipher)));
      const { fields, nonce } = JSON.parse(sealedPlain) as { fields: V3Fields; nonce: string };

      setNote('盾签名解密证明（P7）…');
      const plainSha256ByRole: Record<string, string> = {};
      for (const [role, buf] of Object.entries(plainByRole) as Array<[V3Role, Uint8Array]>) {
        plainSha256ByRole[role] = await sha256Hex(buf);
      }
      const fieldsCommit = await computeV3FieldsCommit(fields, nonce);
      const proofCanonical = buildDecryptProofCanonical({
        openingSessionId: pkg.openingSessionId,
        revision: pkg.revision,
        plainSha256ByRole,
        fieldsCommit,
      });
      const prep = await supplierApi.caPrepare(projectId, 'decrypt-upload');
      const signP7 = await scca.signSccaP7(shield.container, proofCanonical);

      setNote('正在上传明文与证明…');
      const fd = new FormData();
      for (const [role, buf] of Object.entries(plainByRole) as Array<[V3Role, Uint8Array]>) {
        fd.append(`file_${role}`, new Blob([new Uint8Array(buf)], { type: 'application/octet-stream' }), `${role}.plain`);
      }
      fd.append('fieldsJson', canonicalJson(fields));
      fd.append('nonce', nonce);
      fd.append('operationId', prep.operationId);
      fd.append('signatureFormat', 'scca-pkcs7-base64');
      fd.append('signP7', signP7);
      const result = await supplierApi.caDecryptUpload(projectId, fd);

      toast.success('开标解密完成（明文与 P7 解密证明已提交）——请查看唱标表并确认');
      setOpen(false);
      setPin('');
      onDecrypted?.({ decryptStatus: result?.decryptStatus ?? 'SUCCESS' });
    } catch (e: any) {
      setError(e?.message ?? '解密失败');
    } finally {
      setBusy(false);
      setNote('');
    }
  }

  return (
    <>
      <SpButton variant="primary" icon={LockOpen} disabled={busy} onClick={() => { setError(''); setOpen(true); }}>
        取包并解密
      </SpButton>

      <SpDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="SCCA CA 开标解密（双层信封内层）"
        width={440}
        footer={
          <>
            <SpButton variant="soft" disabled={busy} onClick={() => setOpen(false)}>取消</SpButton>
            <SpButton variant="primary" disabled={!pin || busy} loading={busy} onClick={start}>
              {busy ? (note || '解密中...') : '解密并上传'}
            </SpButton>
          </>
        }
      >
        <p className="text-sm font-medium text-[var(--fg-1)]">输入 U盾 PIN 解密标书</p>
        <p className="mt-1 text-xs text-[var(--fg-3)]">大文件约需 1 分钟，请勿关闭页面</p>
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
        {error && (
          <div className="mt-3 text-xs" style={{ color: 'var(--danger, #c0392b)' }} role="alert">{error}</div>
        )}
      </SpDialog>
    </>
  );
}
