/* =================================================================
   ca-bid-reupload-card — dual-v3 开标期补传卡（阶段2.5 T3 · cgzxui）
   流程：取锚点（reupload-context）→ PIN → 盾 unwrap sealedFields 复原
        fields+nonce → 重选各角色原始文件 → reuseNonce 重封（fieldsCommit
        必然一致）→ prepare(reupload) → signing-payload → reupload-v3
   视觉：neu-card + neu-input + neu-btn-soft 三态（同投递卡口径：失败解锁可重试）
   ================================================================= */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { FileWarning, LoaderCircle, UploadCloud, CircleCheck } from 'lucide-react';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { encryptAndUploadV3, unwrapSealedFields, nextRevisionContext } from '@/utils/dual-v3-client';
import type { V3Fields, V3Role } from '@water-erp/ukey';

type Stage = 'loading' | 'form' | 'sealing' | 'signing' | 'submitting' | 'done' | 'failed';

interface CtxInfo {
  baseRevision: number;
  fieldsCommit: string;
  roles: Array<{ role: V3Role; plainSha256: string; plainBytes: number }>;
  sealedFields: { cipher: string; kself: { value: string } };
  supplierId: string;
  signingBindingId: string;
  signingCertFingerprint: string;
  adminCert: { adminCertId: string; publicKey: string };
}

export function CaBidReuploadCard({ projectId, onReuploaded }: {
  projectId: string;
  onReuploaded?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('loading');
  const [ctx, setCtx] = useState<CtxInfo | null>(null);
  const [files, setFiles] = useState<Partial<Record<V3Role, File>>>({});
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const actionIdRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rc, caps, status, adminCert] = await Promise.all([
          supplierApi.getReuploadContext(projectId),
          supplierApi.caCapabilities(),
          supplierApi.getStatus(),
          supplierApi.getAdminCert(),
        ]);
        if (!alive) return;
        const binding = (caps as any)?.activeBinding;
        if (!alive || !binding || binding.kind !== 'ca' || !(status as any)?.id) return;
        setCtx({
          baseRevision: rc.baseRevision,
          fieldsCommit: rc.fieldsCommit,
          roles: rc.roles,
          sealedFields: rc.sealedFields,
          supplierId: (status as any).id,
          signingBindingId: binding.id ?? '',
          signingCertFingerprint: binding.signingCert?.sha256Fingerprint ?? '',
          adminCert: { adminCertId: adminCert.adminCertId, publicKey: adminCert.publicKey },
        });
        setStage('form');
      } catch {
        /* 服务端闸门（阶段/轨道/快照）拒收——不渲染或置错 */
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const allFiles = !!ctx && ctx.roles.every((r) => files[r.role]);
  const canSubmit = (stage === 'form' || stage === 'failed') && allFiles && !!pin && !!ctx;
  const busy = stage === 'sealing' || stage === 'signing' || stage === 'submitting';

  const submit = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    const cancel = () => actionId !== actionIdRef.current;
    if (!ctx) return;
    setError('');
    try {
      setStage('sealing');
      setNote('盾复原唱标字段（fields+nonce）…');
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书');
      const encCertPem = first.enc?.pem;
      if (!encCertPem) throw new Error('U盾证书缺少加密证（enc.pem）');
      await scca.loginScca(first.container, pin);
      // 盾 unwrap sealedFields → DEK_F → fields+nonce（补传必须复用原 nonce）
      const dekFJson = await scca.unwrapSccaKey(first.container, ctx.sealedFields.kself.value);
      const { fields, nonce } = await unwrapSealedFields(dekFJson, ctx.sealedFields);
      const v3Fields: V3Fields = fields;

      setNote('双层加密并暂存新密文…');
      const roleFiles = ctx.roles.map((r) => ({ role: r.role, file: files[r.role]! }));
      const { envelope } = await encryptAndUploadV3(
        projectId, roleFiles, v3Fields, encCertPem, await getWrapAdapter(), ctx.adminCert, {
          uploadOuter: (role, blob, filename) => supplierApi.caUploadEncryptedOuter(projectId, blob, filename)
            .then((r2) => ({ fileAssetId: r2.fileAssetId, outerSha256: r2.outerSha256, outerBytes: r2.outerBytes })),
        },
        nextRevisionContext({ supplierId: ctx.supplierId, submissionId: '', revision: ctx.baseRevision, signingBindingId: ctx.signingBindingId, signingCertFingerprint: ctx.signingCertFingerprint }),
        nonce,
      );
      if (cancel()) return;

      setStage('signing');
      setNote('盾签名补传信封（P7）…');
      const prep = await supplierApi.caPrepare(projectId, 'reupload');
      const frozen = await supplierApi.caSigningPayload(projectId, prep.operationId, envelope);
      const signP7 = await scca.signSccaP7(first.container, frozen.canonical);
      if (cancel()) return;

      setStage('submitting');
      setNote('提交补传（版本推进）…');
      await supplierApi.reuploadV3(projectId, {
        operationId: prep.operationId, signatureFormat: 'scca-pkcs7-base64', signP7, baseRevision: ctx.baseRevision,
      });
      if (cancel()) return;
      setStage('done');
      setNote('');
      onReuploaded?.();
    } catch (e: any) {
      if (cancel()) return;
      setStage('failed');
      setNote('');
      setError(e?.message ?? '补传失败');
    }
  }, [ctx, files, pin, projectId, onReuploaded]);

  if (stage === 'loading') return null;
  if (stage === 'done') {
    return (
      <div className="neu-card" data-testid="ca-reupload-done">
        <div className="flex items-center gap-2" style={{ color: 'var(--sp-ok, #1a7f4b)' }}>
          <CircleCheck size={18} strokeWidth={1.75} />
          <span className="font-medium">补传完成（版本已推进，等待重新解外层与解密）</span>
        </div>
      </div>
    );
  }
  if (!ctx) return null;

  return (
    <div className="neu-card" data-testid="ca-reupload-card">
      <div className="flex items-center gap-2 mb-3">
        <FileWarning size={18} strokeWidth={1.75} />
        <span className="font-medium">SCCA CA 开标期补传（双层信封重封）</span>
      </div>
      <p className="ca-progress-note" data-testid="ca-reupload-hint">
        解密异常恢复：重新选择<b>各角色原始文件</b>（明文哈希须与原版一致）；报价与承诺字段以原版为准（不可变更）。
      </p>
      {ctx.roles.map((r) => (
        <label key={r.role} className="ca-file-row" data-testid={`ca-reupload-file-${r.role}`}>
          <span className="ca-file-label">{r.role}（原版 {r.plainBytes} 字节）</span>
          <input type="file" accept=".pdf,.zip,.rar"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((p) => ({ ...p, [r.role]: f })); }}
            disabled={busy} />
        </label>
      ))}
      <label className="ca-field" data-testid="ca-reupload-pin">
        <span>U盾 PIN</span>
        <input className="neu-input" type="password" value={pin} autoComplete="off"
          onChange={(e) => setPin(e.target.value)} disabled={busy} />
      </label>
      <div className="flex items-center gap-2 mt-3">
        <button className="neu-btn-soft" type="button" disabled={!canSubmit} onClick={submit} data-testid="ca-reupload-btn">
          {busy ? <LoaderCircle size={15} strokeWidth={1.75} className="ca-spin" /> : <UploadCloud size={15} strokeWidth={1.75} />}
          重封并补传
        </button>
        {note && <span className="ca-progress-note" data-testid="ca-reupload-progress">{note}</span>}
      </div>
      {error && <div className="ca-error" data-testid="ca-reupload-error" role="alert">{error}</div>}
    </div>
  );
}

async function getWrapAdapter() {
  const mod = (await import('@/utils/scca-ukey')) as any;
  return { wrapKeyToEncCert: (pem: string, json: string) => mod.wrapSccaKey(pem, json) };
}
