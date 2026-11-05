/* =================================================================
   ca-opening-decrypt-card — dual-v3 开标解密（阶段2 Task12 · 2026-10-14 重构；
   2026-11-05 流式化：C_inner 下载解密移 worker 数据面——进度/哈希/取消）
   交互（用户裁定）：按钮触发 → 弹窗输 PIN → 执行；成功后由父页卸载。
   流程：取包（opening-package v3）→ 逐角色盾 unwrapKey(kself P7) → DEK_S →
        引擎流式下载解密 C_inner（worker：进度按密文字节推进、plainSha256 随流
        增量产出直接作 P7 证明——主线程零整读零整算，busy 态可取消）→
        sealedFields 解出 fields+nonce → P7 解密证明 → decrypt-upload（回传进度）。
   样式：SpDialog/SpButton 对齐大厅既有弹窗体系（与确认唱标按钮同构）；弹窗 busy
        态自带防误关+进度（P-3 裁定——本卡不叠全屏遮罩）。
   ================================================================= */
'use client';
import { useRef, useState } from 'react';
import { LockOpen, LoaderCircle, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useLeaveGuard } from '@/hooks/use-leave-guard';
import { supplierApi } from '@/lib/api/supplier';
import * as scca from '@/utils/scca-ukey';
import { assertSecureContext, buildDecryptProofCanonical, pickShieldByFingerprint } from '@/utils/dual-v3-client';
import { getDefaultCryptoEngine } from '@/utils/crypto-engine';
import { canonicalJson, computeV3FieldsCommit, sm4Decrypt } from '@water-erp/ukey';
import type { V3Fields, V3Role } from '@water-erp/ukey';
import { SpButton, SpDialog } from '@/components/ui';

interface PkgFile { role: V3Role; innerAsset: string; downloadUrl: string; innerSha256: string; innerBytes: number; kself: { format: string; recipientCertFingerprint: string; value: string } }

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

/** 解密相位取消文案（置旗 + terminate 引擎后 catch 优先展示——弹窗回初始态可重试） */
const DECRYPT_CANCEL_MSG = '已取消解密，标书未提交，可重新解密';

/** 纯函数：解密相位进度行——已知总量走百分比（向下取整+封顶 100），
 *  无 Content-Length（total=0）只报已下载量 */
export function decryptProgressNote(role: string, doneBytes: number, totalBytes: number): string {
  if (totalBytes > 0) {
    const pct = Math.min(100, Math.floor((doneBytes / totalBytes) * 100));
    return `正在解密 ${role}（下载解密 ${pct}%）…`;
  }
  return `正在解密 ${role}（已下载 ${(doneBytes / 1024 / 1024).toFixed(1)}MB）…`;
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
  /** 解密相位旗（F4）：仅逐角色 decryptUrl 循环期间为 true——取消钮只在该窗口渲染
   *  （unwrap/P7/上传相位 terminate 无效，不显示可点而无效的按钮）；关闭闸 !busy 不变 */
  const [decrypting, setDecrypting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  /** 解密相位取消旗：置旗 + abort + terminate 引擎（幂等）——pending reject 落 catch 专用文案 */
  const cancelRef = useRef(false);
  /** 解密相位取消信号（F5 修复波）：local 降级引擎 terminate 是 no-op、长时间无
   *  效——AbortController 才能中断其流式管线（块边界 CRYPTO_CANCELLED） */
  const abortRef = useRef<AbortController | null>(null);

  // 解密/上传在途离开守卫（终审二轮 F6）：刷新/关闭=解密与已传部分全部重来——busy 期间确认拦截
  useLeaveGuard(busy, '正在解密/上传标书，刷新或关闭页面将丢失全部进度，确定离开吗？');

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
    assertSecureContext(); // LAN http 下 crypto.subtle（fieldsCommit/证明哈希）首触即裸 TypeError——先给指引
    setBusy(true);
    setError('');
    cancelRef.current = false;
    const controller = new AbortController(); // 每次执行新控制器——上次取消不留残迹
    abortRef.current = controller;
    try {
      setNote('正在获取开标解密包…');
      const pkg = await supplierApi.getOpeningPackage(projectId);
      if (!pkg.files?.length || !pkg.sealedFields) throw new Error('解密包未就绪（外层尚未解密）');

      setNote('正在读取 U盾…');
      const certs = await scca.listSccaCerts();
      // 按信封收件证书指纹选盾——多盾并插/换错盾当场点名，不再盲取 certs[0]（2026-10-22 世纪远景实录）
      const shield = await pickShieldByFingerprint(certs, pkg.files?.[0]?.kself?.recipientCertFingerprint);
      await scca.loginScca(shield.container, pin);

      // 逐角色流式解密（worker 数据面）：下载+SM4+增量哈希全在 worker——主线程零整读
      // 零整算，进度按密文字节推进；plainBlob/plainSha256 直接落表（哈希作 P7 证明）
      const engine = getDefaultCryptoEngine();
      const plainByRole: Partial<Record<V3Role, Blob>> = {};
      const plainSha256ByRole: Record<string, string> = {};
      setDecrypting(true); // 解密相位开窗——取消钮在此窗口内可见（F4）
      for (const f of pkg.files as PkgFile[]) {
        // 角色边界取消哨兵（F5 修复波）：盾解封（unwrapSccaKey）是主线程原子段不可中断，
        // 点击取消后若恰无流式解密在途（如恰在盾操作/两角色间隙），置旗无 pending 可拒
        // 会静默继续走完上传——此处按角色边界拦停（与提交页文件边界哨兵同模式）
        if (cancelRef.current) throw new Error(DECRYPT_CANCEL_MSG);
        setNote(`正在解密 ${f.role}（${(f.innerBytes / 1024 / 1024).toFixed(1)}MB）…`);
        const dekJson = await scca.unwrapSccaKey(shield.container, f.kself.value);
        const dek = JSON.parse(dekJson) as { k: string; iv: string };
        const r = await engine.decryptUrl(
          f.downloadUrl,
          { keyHex: dek.k, ivHex: dek.iv },
          (doneBytes, totalBytes) => setNote(decryptProgressNote(f.role, doneBytes, totalBytes)),
          controller.signal, // 取消通道（F5）：local 引擎中断流式管线；worker 引擎 abort 即 terminate
        );
        plainByRole[f.role] = r.plainBlob;
        plainSha256ByRole[f.role] = r.plainSha256;
      }
      setDecrypting(false); // 解密相位关窗——后续 unwrap/P7/上传不可取消（terminate 无管辖）

      setNote('正在揭示唱标字段…');
      const dekFJson = await scca.unwrapSccaKey(shield.container, pkg.sealedFields.kself.value);
      const dekF = JSON.parse(dekFJson);
      const sealedPlain = new TextDecoder().decode(hexToBytes(sm4Decrypt(dekF.k, dekF.iv, pkg.sealedFields.cipher)));
      const { fields, nonce } = JSON.parse(sealedPlain) as { fields: V3Fields; nonce: string };

      setNote('盾签名解密证明（P7）…');
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
      for (const [role, blob] of Object.entries(plainByRole) as Array<[V3Role, Blob]>) {
        fd.append(`file_${role}`, blob, `${role}.plain`); // Blob 直传（worker 产物句柄，不重建）
      }
      fd.append('fieldsJson', canonicalJson(fields));
      fd.append('nonce', nonce);
      fd.append('operationId', prep.operationId);
      fd.append('signatureFormat', 'scca-pkcs7-base64');
      fd.append('signP7', signP7);
      const result = await supplierApi.caDecryptUpload(projectId, fd, (pct) => setNote(`上传明文 ${pct}%`));

      toast.success('开标解密完成，明文与解密证明已提交。请查看唱标表并确认');
      setOpen(false);
      setPin('');
      onDecrypted?.({ decryptStatus: result?.decryptStatus ?? 'SUCCESS' });
    } catch (e: any) {
      // 取消走专用文案（terminate 的 reject/后续失败归并）——留在弹窗可重试
      setError(cancelRef.current ? DECRYPT_CANCEL_MSG : (e?.message ?? '解密失败'));
    } finally {
      setBusy(false);
      setNote('');
      setDecrypting(false);
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
        {busy && decrypting && (
          <>
            {/* busy 态取消（弹窗关闭闸 !busy 保留；F4：仅解密相位渲染——terminate
                只管辖流式解密）：置旗 + abort 信号（F5：local 降级引擎 terminate 是
                no-op，靠信号中断块边界）+ terminate 引擎（幂等，worker 轨 pending
                reject 落 catch）——角色边界哨兵兜住盾操作间隙的取消；上传相位 XHR
                不在引擎管辖（Task8 未暴露 abort），不渲染本钮即不存在点了没反应的窗口 */}
            <div className="mt-3 flex justify-end">
              <SpButton variant="soft" onClick={() => { cancelRef.current = true; abortRef.current?.abort(); getDefaultCryptoEngine().terminate(); }}>
                取消解密
              </SpButton>
            </div>
          </>
        )}
        {error && (
          <div className="mt-3 text-xs text-[var(--danger)]" role="alert">{error}</div>
        )}
      </SpDialog>
    </>
  );
}
