/* =================================================================
   ca-bid-reupload-card — dual-v3 开标期补传（阶段2.5 T3 · 2026-10-15 重构）
   交互（同解密卡模式）：按钮触发 → 弹窗（文件选择+PIN）→ 执行；完成后刷新。
   流程：取锚点（reupload-context）→ 盾复原 fields+nonce → 重选原文件 →
        reuseNonce 重封 → prepare(reupload) → 盾签 → reupload-v3。
   ================================================================= */
'use client';
import { useState, useEffect } from 'react';
import { FileWarning, LoaderCircle, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { encryptAndUploadV3, unwrapSealedFields, nextRevisionContext, pickShieldByFingerprint } from '@/utils/dual-v3-client';
import { withCryptoOverlay } from '@/utils/crypto-overlay';
import { getDefaultCryptoEngine } from '@/utils/crypto-engine';
import type { V3Fields, V3Role } from '@water-erp/ukey';
import { SpButton, SpDialog } from '@/components/ui';

/** ② 重封段遮罩取消文案（cancel 置旗 + terminate 引擎后 inline error 展示） */
const CRYPTO_CANCEL_MSG = '已取消加密，文件未提交';

type Stage = 'loading' | 'ready' | 'running';

interface CtxInfo {
  baseRevision: number;
  roles: Array<{ role: V3Role; plainSha256: string; plainBytes: number }>;
  sealedFields: { cipher: string; kself: { recipientCertFingerprint?: string; value: string } };
  supplierId: string;
  signingBindingId: string;
  signingCertFingerprint: string;
  adminCert: { adminCertId: string; publicKey: string };
}

const ROLE_LABEL: Record<V3Role, string> = {
  technical: '技术标', business: '商务标', coverLetter: '投标函', bond: '保证金凭证',
};

export function CaBidReuploadCard({ projectId, onReuploaded }: {
  projectId: string;
  onReuploaded?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('loading');
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxInfo | null>(null);
  const [files, setFiles] = useState<Partial<Record<V3Role, File>>>({});
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

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
        const fingerprint: unknown = binding?.signingCert?.sha256Fingerprint;
        if (!binding || binding.kind !== 'ca' || typeof fingerprint !== 'string' || !(status as any)?.id) return;
        setCtx({
          baseRevision: rc.baseRevision,
          roles: rc.roles,
          sealedFields: rc.sealedFields,
          supplierId: (status as any).id,
          signingBindingId: binding.id ?? '',
          signingCertFingerprint: fingerprint,
          adminCert: { adminCertId: adminCert.adminCertId, publicKey: adminCert.publicKey },
        });
        setStage('ready');
      } catch { /* 服务端闸门拒收（阶段/轨道/快照）——不渲染 */ }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const allFiles = !!ctx && ctx.roles.every((r) => files[r.role]);
  const canSubmit = stage !== 'loading' && stage !== 'running' && allFiles && !!pin && !!ctx;

  async function submit() {
    if (!ctx || !pin) return;
    setStage('running');
    setError('');
    // ② 重封段遮罩取消旗：cancel 回调置旗 + abort 信号 + terminate 引擎
    //   （均幂等，双击安全；F5 修复波：local 降级引擎靠 AbortSignal 中断流式管线）
    let cryptoCancelled = false;
    const cancelController = new AbortController();
    try {
      // ① 盾复原 fields+nonce（补传必须复用原 nonce——fieldsCommit 与原版一致）
      setNote('盾复原唱标字段（fields+nonce）…');
      const certs = await scca.listSccaCerts();
      // 按原信封收件证书指纹选盾——错盾既解不开原 kself，重封还会把新信封封给错盾（2026-10-22 实录）
      const shield = await pickShieldByFingerprint(certs, ctx.sealedFields.kself.recipientCertFingerprint);
      const encCertPem = shield.enc?.pem;
      if (!encCertPem) throw new Error('U盾证书缺少加密证');
      await scca.loginScca(shield.container, pin);
      const dekFJson = await scca.unwrapSccaKey(shield.container, ctx.sealedFields.kself.value);
      const { fields, nonce } = await unwrapSealedFields(dekFJson, ctx.sealedFields);

      // ② 重封（reuseNonce——fieldsCommit 必然与原版一致）——加密+上传段挂遮罩（同投递页③）：
      //    加密相位=engine 分块进度（byte 口径）、上传相位=XHR 百分比内嵌 phase 文案；
      //    取消=置旗 + terminate 引擎 + 文件边界哨兵，遮罩待 promise 落定才撤。③ 签名/提交在遮罩外。
      const roleFiles = ctx.roles.map((r) => ({ role: r.role, file: files[r.role]! }));
      let fileIdx = 0; // 已完成上传的文件数——file i 的加密先于其上传，加密相位标签=fileIdx+1
      const { envelope } = await withCryptoOverlay(
        async (report) => {
          const ensureNotCancelled = () => {
            if (cryptoCancelled) throw new Error(CRYPTO_CANCEL_MSG);
          };
          const built = await encryptAndUploadV3(
            projectId, roleFiles, fields as V3Fields, encCertPem, {
              wrapKeyToEncCert: (pem, json) => scca.wrapSccaKey(pem, json),
            }, ctx.adminCert, {
              // 加密相位：deps.onProgress → engine 第 4 参 →「加密中 i/n xx%（a/b MB）」
              onProgress: (done, total) => report({
                phase: `加密中 ${fileIdx + 1}/${roleFiles.length}`,
                doneBytes: done, totalBytes: total,
              }),
              // 取消信号（F5）：透传 engine 第 5 参——local 引擎块边界中断、worker abort 即 terminate
              signal: cancelController.signal,
              uploadOuter: (role, blob, filename) => {
                ensureNotCancelled(); // 上传相位点取消——止步于下一文件边界
                const idx = ++fileIdx;
                setNote(`双层加密并暂存新密文 ${idx}/${roleFiles.length}…`);
                return supplierApi.caUploadEncryptedOuter(projectId, blob, filename, (pct) =>
                  report({ phase: `上传中 ${idx}/${roleFiles.length} ${pct}%` }),
                )
                  .then((r) => ({ fileAssetId: r.fileAssetId, outerSha256: r.outerSha256, outerBytes: r.outerBytes }));
              },
            },
            nextRevisionContext({
              supplierId: ctx.supplierId, submissionId: '', revision: ctx.baseRevision,
              signingBindingId: ctx.signingBindingId, signingCertFingerprint: ctx.signingCertFingerprint,
            }),
            nonce,
          );
          ensureNotCancelled(); // 单文件场景在上传中点取消——上传完成即止步，不进③签名
          return built;
        },
        { cancel: () => { cryptoCancelled = true; cancelController.abort(); getDefaultCryptoEngine().terminate(); } },
      );

      // ③ 冻结 → 盾签 → 提交
      setNote('正在用 U盾签名补传文件…');
      const prep = await supplierApi.caPrepare(projectId, 'reupload');
      const frozen = await supplierApi.caSigningPayload(projectId, prep.operationId, envelope);
      const signP7 = await scca.signSccaP7(shield.container, frozen.canonical);
      setNote('提交补传（版本推进）…');
      await supplierApi.reuploadV3(projectId, {
        operationId: prep.operationId, signatureFormat: 'scca-pkcs7-base64',
        signP7, baseRevision: ctx.baseRevision,
      });
      toast.success('补传完成（版本已推进，等待重新解密）');
      setOpen(false);
      setPin('');
      setFiles({});
      onReuploaded?.();
    } catch (e: any) {
      // 取消走专用文案（留在弹窗可重投——finally 已复位 stage/note）；其余给 message
      if (cryptoCancelled) setError(CRYPTO_CANCEL_MSG);
      else setError(e?.message ?? '补传失败');
    } finally {
      setStage('ready');
      setNote('');
    }
  }

  if (stage === 'loading') return null;

  return (
    <>
      <SpButton variant="primary" icon={FileWarning} disabled={stage === 'running'} onClick={() => { setError(''); setOpen(true); }}>
        开标期补传
      </SpButton>

      <SpDialog
        open={open}
        onClose={() => stage !== 'running' && setOpen(false)}
        title="SCCA CA 开标期补传（重新加密上传）"
        width={480}
        footer={
          <>
            <SpButton variant="soft" disabled={stage === 'running'} onClick={() => setOpen(false)}>取消</SpButton>
            <SpButton variant="primary" disabled={!canSubmit} loading={stage === 'running'} onClick={submit}>
              {stage === 'running' ? (note || '补传中...') : '重封并补传'}
            </SpButton>
          </>
        }
      >
        <p className="text-sm font-medium text-[var(--fg-1)]">重新上传原始标书文件</p>
        <p className="mt-1 text-xs text-[var(--fg-3)]">文件须与投递时一致，报价不变</p>
        {ctx?.roles.map((r) => (
          <div key={r.role} className="mt-3">
            <label className="mb-1 block text-sm font-medium">{ROLE_LABEL[r.role] ?? r.role}</label>
            <input
              type="file" accept=".pdf,.zip,.rar" disabled={stage === 'running'}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((p) => ({ ...p, [r.role]: f })); e.target.value = ''; }}
              className="neu-input w-full text-sm"
            />
            {files[r.role] && (
              <p className="mt-1 text-xs text-[var(--fg-3)]">{files[r.role]!.name}（{Math.round(files[r.role]!.size / 1024)}KB）</p>
            )}
          </div>
        ))}
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium">U盾 PIN</label>
          <input type="password" value={pin} autoComplete="off" disabled={stage === 'running'}
            onChange={(e) => setPin(e.target.value)} placeholder="请输入 U盾 PIN"
            className="neu-input w-full" />
        </div>
        {stage === 'running' && (
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-3)]">
            <LoaderCircle size={12} className="animate-spin" />{note || '处理中…'}
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-[var(--danger)]" role="alert">{error}</div>
        )}
      </SpDialog>
    </>
  );
}
