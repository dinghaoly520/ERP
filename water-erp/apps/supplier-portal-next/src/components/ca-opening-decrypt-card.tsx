/* =================================================================
   ca-opening-decrypt-card — dual-v3 开标解密卡（cgzxui 化 · 阶段2 Task12）
   流程：PIN → 取包（opening-package v3）→ 逐角色下载 C_inner →
        盾 unwrapKey(kself P7)→DEK_S→SM4 解密 → sealedFields 解出 fields+nonce →
        P7 解密证明（canonical 与服务端 Task9 逐字一致）→ decrypt-upload
   视觉：neu-card + neu-input + neu-btn-soft 三态 + 角色进度行
   ================================================================= */
'use client';
import { useState, useCallback, useRef } from 'react';
import { KeyRound, LoaderCircle, LockOpen, CircleCheck } from 'lucide-react';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { buildDecryptProofCanonical } from '@/utils/dual-v3-client';
import { canonicalJson, computeV3FieldsCommit, sha256Hex, sm4Decrypt } from '@water-erp/ukey';
import type { V3Role, V3Fields } from '@water-erp/ukey';

type Stage = 'idle' | 'fetching' | 'decrypting' | 'proving' | 'done' | 'failed';

interface PkgFile { role: V3Role; innerAsset: string; downloadUrl: string; innerSha256: string; innerBytes: number; kself: { format: string; recipientCertFingerprint: string; value: string } }

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

async function fetchCInner(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'include', headers: { 'X-Portal': 'supplier' } });
  if (!res.ok) throw new Error(`C_inner 下载失败(${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function CaOpeningDecryptCard({ projectId, onDecrypted }: {
  projectId: string;
  onDecrypted?: (outcome: { decryptStatus: string }) => void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [roleDone, setRoleDone] = useState<string[]>([]);
  const actionIdRef = useRef(0);

  const start = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    const cancel = () => actionId !== actionIdRef.current;
    setError('');
    try {
      setStage('fetching');
      setNote('正在获取开标解密包…');
      const pkg = await supplierApi.getOpeningPackage(projectId);
      if (cancel()) return;
      if (!pkg.files?.length || !pkg.sealedFields) throw new Error('解密包未就绪（外层尚未解密）');

      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error('U盾内未找到证书');
      await scca.loginScca(first.container, pin);
      const container = first.container;

      setStage('decrypting');
      const plainByRole: Partial<Record<V3Role, Uint8Array>> = {};
      for (const f of pkg.files as PkgFile[]) {
        setNote(`正在解密 ${f.role}…`);
        const cInner = await fetchCInner(f.downloadUrl);
        // 盾 unwrapKey（kself P7）→ keyWrapJson → DEK_S → SM4 解密
        const dekJson = await scca.unwrapSccaKey(container, f.kself.value);
        const dek = JSON.parse(dekJson);
        const plainHex = sm4Decrypt(dek.k, dek.iv, bytesToHex(cInner));
        plainByRole[f.role] = hexToBytes(plainHex);
        setRoleDone((prev) => [...prev, f.role]);
        if (cancel()) return;
      }

      // sealedFields：DEK_F 反解 fields + nonce（Ruling：cipher=canonicalJson({fields, nonce})）
      setNote('正在揭示唱标字段…');
      const dekFJson = await scca.unwrapSccaKey(container, pkg.sealedFields.kself.value);
      const dekF = JSON.parse(dekFJson);
      const sealedPlain = new TextDecoder().decode(hexToBytes(sm4Decrypt(dekF.k, dekF.iv, pkg.sealedFields.cipher)));
      const { fields, nonce } = JSON.parse(sealedPlain) as { fields: V3Fields; nonce: string };

      setStage('proving');
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
      const signP7 = await scca.signSccaP7(container, proofCanonical);
      if (cancel()) return;

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
      if (cancel()) return;

      setStage('done');
      setNote('');
      onDecrypted?.({ decryptStatus: result?.decryptStatus ?? 'SUCCESS' });
    } catch (e: any) {
      if (cancel()) return;
      setStage('failed');
      setNote(''); // 失败清进度残句（同投递卡口径）
      setError(e?.message ?? '解密失败');
    }
  }, [projectId, pin, onDecrypted]);

  if (stage === 'done') {
    return (
      <div className="neu-card" data-testid="ca-decrypt-done">
        <div className="flex items-center gap-2" style={{ color: 'var(--sp-ok, #1a7f4b)' }}>
          <CircleCheck size={18} strokeWidth={1.75} />
          <span className="font-medium">开标解密完成（明文与 P7 解密证明已提交）</span>
        </div>
      </div>
    );
  }

  return (
    <div className="neu-card" data-testid="ca-decrypt-card">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound size={18} strokeWidth={1.75} />
        <span className="font-medium">SCCA CA 开标解密（双层信封内层）</span>
      </div>
      <label className="ca-field" data-testid="ca-decrypt-pin">
        <span>U盾 PIN</span>
        <input className="neu-input" type="password" value={pin} autoComplete="off"
          onChange={(e) => setPin(e.target.value)} disabled={stage !== 'idle' && stage !== 'failed'} />
      </label>
      <div className="flex items-center gap-2 mt-3">
        <button className="neu-btn-soft" type="button" disabled={!pin || (stage !== 'idle' && stage !== 'failed')}
          onClick={start} data-testid="ca-decrypt-btn">
          {stage !== 'idle' && stage !== 'failed' ? <LoaderCircle size={15} strokeWidth={1.75} className="ca-spin" /> : <LockOpen size={15} strokeWidth={1.75} />}
          取包并解密
        </button>
        {note && <span className="ca-progress-note" data-testid="ca-decrypt-progress">{note}</span>}
      </div>
      {roleDone.length > 0 && (
        <div className="ca-roles" data-testid="ca-decrypt-roles">
          已解密：{roleDone.join('、')}
        </div>
      )}
      {error && <div className="ca-error" data-testid="ca-decrypt-error" role="alert">{error}</div>}
    </div>
  );
}
