/* =================================================================
   ca-bid-submit-card — dual-v3 投递卡片（cgzxui 化 2026-10-14 · 阶段2 Task11）
   流程：选文件（technical 必选）→ 唱标字段（万元）→ U盾 PIN →
        双层加密+暂存上传 → prepare → signing-payload → 盾 P7 签名 → submit v3
   视觉：neu-card 卡片 + neu-btn-soft 或 primary 三态 + 进度步骤行（无反模式类与 emoji）
   ================================================================= */
'use client';
import { useState, useCallback, useRef } from 'react';
import { ShieldCheck, LoaderCircle, FileText, UploadCloud, CircleCheck } from 'lucide-react';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { encryptAndUploadV3, nextRevisionContext } from '@/utils/dual-v3-client';
import type { V3Role, V3Fields } from '@water-erp/ukey';

type Stage = 'form' | 'encrypting' | 'signing' | 'submitting' | 'done' | 'failed';

const ROLE_LABEL: Record<V3Role, string> = {
  technical: '技术标（必选）',
  business: '商务标',
  coverLetter: '投标函',
  bond: '投标保证金凭证',
};

export interface CaBidSubmitCardProps {
  projectId: string;
  /** 信封上下文（capabilities/binding 下发） */
  context: { supplierId: string; submissionId: string; revision: number; signingBindingId: string; signingCertFingerprint: string };
  /** 管理方加密证书（kadmin 收件人） */
  adminCert: { adminCertId: string; publicKey: string };
  /** 已递交回调（父页刷新投递状态） */
  onSubmitted?: (result: { submissionId: string; revision: number }) => void;
}

export function CaBidSubmitCard({ projectId, context, adminCert, onSubmitted }: CaBidSubmitCardProps) {
  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState('');
  const [progressNote, setProgressNote] = useState('');
  const [files, setFiles] = useState<Partial<Record<V3Role, File>>>({});
  const [price, setPrice] = useState('');
  const [deliveryPeriod, setDeliveryPeriod] = useState('');
  const [qualityCommitment, setQualityCommitment] = useState('');
  const [pin, setPin] = useState('');
  const [container, setContainer] = useState('');
  const actionIdRef = useRef(0);

  const fieldsValid = /^\d{1,12}(\.\d{1,4})?$/.test(price.trim()) && deliveryPeriod.trim() && qualityCommitment.trim();
  // failed 态放行——失败后原页可改字段重试（UI 验收发现：inputs 解锁但按钮死锁）
  const canSubmit = (stage === 'form' || stage === 'failed') && !!files.technical && fieldsValid && !!pin;

  const pick = (role: V3Role) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFiles((prev) => ({ ...prev, [role]: f }));
  };

  const submit = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    setError('');
    const cancel = () => actionId !== actionIdRef.current;
    try {
      setStage('encrypting');
      setProgressNote('正在双层加密并暂存密文…');
      const v3Fields: V3Fields = {
        price: price.trim(), amountUnit: '万元', currency: 'CNY',
        deliveryPeriod: deliveryPeriod.trim(), qualityCommitment: qualityCommitment.trim(),
      };
      const roleFiles = (Object.entries(files) as Array<[V3Role, File | undefined]>)
        .filter((entry): entry is [V3Role, File] => !!entry[1])
        .map(([role, f]) => ({ role, file: f }));
      // 盾枚举：容器 + 加密证 PEM（kself 收件人——随盾在位，不落库不缓存）
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书');
      const encCertPem = first.enc?.pem;
      if (!encCertPem) throw new Error('U盾证书缺少加密证（enc.pem）');
      // C-1（复审）：信封 context.revision = 当前 revision + 1（服务端按 ===newRev 硬校验；
      // 首投 0 会被 ukey validator 直接拒）；baseRevision（CAS 基线）保持当前值
      const { envelope } = await encryptAndUploadV3(projectId, roleFiles, v3Fields, encCertPem, await sccaGetAdapter(), adminCert, {
        uploadOuter: (role, blob, filename) => supplierApi.caUploadEncryptedOuter(projectId, blob, filename)
          .then((r) => ({ fileAssetId: r.fileAssetId, outerSha256: r.outerSha256, outerBytes: r.outerBytes })),
      }, nextRevisionContext(context));
      if (cancel()) return;

      setStage('signing');
      setProgressNote('盾签名信封原文（P7）…');
      let containerId = container;
      if (!containerId) {
        containerId = first.container;
        setContainer(containerId);
        await scca.loginScca(containerId, pin);
      }
      const prep = await supplierApi.caPrepare(projectId, 'submit');
      const frozen = await supplierApi.caSigningPayload(projectId, prep.operationId, envelope);
      const signP7 = await scca.signSccaP7(containerId, frozen.canonical);
      if (cancel()) return;

      setStage('submitting');
      setProgressNote('提交投递…');
      await supplierApi.submitBid(projectId, {
        operationId: prep.operationId,
        signatureFormat: 'scca-pkcs7-base64',
        signP7,
        baseRevision: context.revision, // CAS 基线=当前值（信封声明的是 +1，两者刻意不同）
      });
      if (cancel()) return;
      setStage('done');
      setProgressNote('');
      onSubmitted?.({ submissionId: context.submissionId, revision: context.revision + 1 });
    } catch (e: any) {
      if (cancel()) return;
      setStage('failed');
      setProgressNote('');
      setError(e?.message ?? '投递失败');
    }
  }, [projectId, files, price, deliveryPeriod, qualityCommitment, pin, adminCert, context, container, onSubmitted]);

  if (stage === 'done') {
    return (
      <div className="neu-card" data-testid="ca-submit-done">
        <div className="flex items-center gap-2" style={{ color: 'var(--sp-ok, #1a7f4b)' }}>
          <CircleCheck size={18} strokeWidth={1.75} />
          <span className="font-medium">投标文件已递交（dual-v3 双信封 + 盾 P7 签名）</span>
        </div>
      </div>
    );
  }

  return (
    <div className="neu-card" data-testid="ca-submit-card">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={18} strokeWidth={1.75} />
        <span className="font-medium">SCCA CA 投标投递（双层信封）</span>
      </div>

      {(Object.keys(ROLE_LABEL) as V3Role[]).map((role) => (
        <label key={role} className="ca-file-row" data-testid={`ca-file-${role}`}>
          <span className="ca-file-label">{ROLE_LABEL[role]}{!files[role] && role === 'technical' ? '' : ''}</span>
          <input type="file" accept=".pdf,.zip,.rar" onChange={pick(role)} disabled={stage !== 'form' && stage !== 'failed'} />
          {files[role] && <FileText size={14} strokeWidth={1.75} />}
        </label>
      ))}

      <label className="ca-field" data-testid="ca-field-price">
        <span>报价（万元）</span>
        <input className="neu-input" inputMode="decimal" placeholder="如 153.95" value={price}
          onChange={(e) => setPrice(e.target.value)} disabled={stage !== 'form' && stage !== 'failed'} />
      </label>
      <label className="ca-field" data-testid="ca-field-period">
        <span>工期</span>
        <input className="neu-input" placeholder="如 90 日历天" value={deliveryPeriod}
          onChange={(e) => setDeliveryPeriod(e.target.value)} disabled={stage !== 'form' && stage !== 'failed'} />
      </label>
      <label className="ca-field" data-testid="ca-field-quality">
        <span>质量承诺</span>
        <input className="neu-input" placeholder="如 合格" value={qualityCommitment}
          onChange={(e) => setQualityCommitment(e.target.value)} disabled={stage !== 'form' && stage !== 'failed'} />
      </label>
      <label className="ca-field" data-testid="ca-field-pin">
        <span>U盾 PIN</span>
        <input className="neu-input" type="password" value={pin} autoComplete="off"
          onChange={(e) => setPin(e.target.value)} disabled={stage !== 'form' && stage !== 'failed'} />
      </label>

      <div className="flex items-center gap-2 mt-3">
        <button className="neu-btn-soft" type="button" disabled={!canSubmit} onClick={submit}
          data-testid="ca-submit-btn">
          {stage !== 'form' && stage !== 'failed' ? <LoaderCircle size={15} strokeWidth={1.75} className="ca-spin" /> : <UploadCloud size={15} strokeWidth={1.75} />}
          加密并递交
        </button>
        {progressNote && <span className="ca-progress-note" data-testid="ca-progress">{progressNote}</span>}
      </div>
      {error && <div className="ca-error" data-testid="ca-error" role="alert">{error}</div>}
    </div>
  );
}

/** 取 scca-ukey 单例 adapter（wrapKeyToEncCert 签名面） */
async function sccaGetAdapter() {
  const mod = (await import('@/utils/scca-ukey')) as any;
  // wrapKeyToEncCert(pem, json) 直通——adapter 形状只要求此方法
  return {
    wrapKeyToEncCert: (pem: string, json: string) => mod.wrapSccaKey(pem, json),
  };
}
