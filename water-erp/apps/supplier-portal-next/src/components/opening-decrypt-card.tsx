"use client";

/**
 * 双信封 v2：解密我的投标（§5.3）— 移植自 Vue OpeningHall.vue 的解密卡。
 * OPENING 阶段轮询 opening-package（10s，silent）；旧轨（NOT_DUAL_TRACK）自动隐藏。
 * 密封核验：下载 C_inner 本地重算 SHA-256 与投递存证比对（电子招标投标法第36条电子化对应物）。
 * 解密：U盾解 kself→DEK_S→SM4 解密各角色文件 + sealedFields 揭示唱标字段 → decrypt-upload
 * （双闸失败为 HTTP 200 + decryptStatus='DANGER'，须读返回值判定）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, ShieldX, CircleX, Info, TriangleAlert, CircleCheck } from "lucide-react";
import { sha256Hex, canonicalJson, sm4Decrypt, unwrapDekJson, type UKeyAdapter } from "@water-erp/ukey";
import { openUkey } from "@/utils/ukey-factory";
import { useUkeyPresence } from "@/utils/use-ukey-presence";
import { getOpeningPackage, decryptUpload, type OpeningPackage } from "@/lib/api/opening-package";
import { hexToUtf8, bytesToHex, hexToBytes } from "@/utils/dual-envelope-core";
import { SpButton, SpDialog, SpInput } from "@/components/ui";

const ROLE_LABELS: Record<string, string> = {
  technical: "技术标", business: "商务标", coverLetter: "投标函", bond: "保证金凭证",
};
const PKG_ERROR_TEXT: Record<string, string> = {
  OUTER_NOT_DECRYPTED: "外层尚未解密，等待主持方解外层",
  DECRYPT_WINDOW_NOT_OPEN: "解密窗口尚未开启",
  DECRYPT_WINDOW_CLOSED: "解密窗口已关闭，请联系主持人延长窗口",
  OPENING_PAUSED: "开标已暂停，等待主持人恢复",
  OPENING_NOT_STARTED: "开标尚未启动（主持人组建会话后开始）",
  NOT_DUAL_TRACK: "本标书为传统加密投递，由主持人统一解密",
  NO_SUBMISSION: "尚未提交投标文件",
  ENVELOPE_MISSING: "信封缺失，请联系平台排查",
  PROJECT_NOT_OPENING: "项目不在开标阶段",
};

function boundCertSn(): string {
  try {
    const raw = localStorage.getItem("supplier_ukey_bound");
    return raw ? (JSON.parse(raw)?.certSn ?? "") : "";
  } catch { return ""; }
}

export function OpeningDecryptCard({ projectId, isOpening, submitted, profileSm2PublicKey, onDecrypted }: {
  projectId: string;
  isOpening: boolean;
  submitted: boolean;
  profileSm2PublicKey: string;
  onDecrypted?: () => void;
}) {
  const [isDualTrack, setIsDualTrack] = useState<boolean | null>(null);
  const [pkg, setPkg] = useState<OpeningPackage | null>(null);
  const [pkgState, setPkgState] = useState<"loading" | "ready" | "waiting" | "error">("loading");
  const [pkgError, setPkgError] = useState<{ code: string; error: string } | null>(null);
  const sealKeyRef = useRef("");
  const [sealResults, setSealResults] = useState<Record<string, "pending" | "ok" | "fail" | "unavailable">>({});
  const [sealChecking, setSealChecking] = useState(false);
  const cachedInnerRef = useRef<Record<string, { assetId: string; bytes: Uint8Array }>>({});
  const [ukeyAdapter, setUkeyAdapter] = useState<UKeyAdapter | null>(null);
  const [ukeyCertSn, setUkeyCertSn] = useState("");
  const [ukeyPassword, setUkeyPassword] = useState("");
  const [ukeyOpening, setUkeyOpening] = useState(false);
  const [ukeyDialogVisible, setUkeyDialogVisible] = useState(false);
  const ukeyPresent = useUkeyPresence(ukeyDialogVisible); // 严格模式:弹窗开着时轮询U盾在场
  const [decrypting, setDecrypting] = useState(false);
  const [decryptStage, setDecryptStage] = useState("");
  const [decryptError, setDecryptError] = useState("");
  const [revealedFields, setRevealedFields] = useState<{ price: string; deliveryPeriod: string; qualityCommitment: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pubKeyRef = useRef(profileSm2PublicKey);
  pubKeyRef.current = profileSm2PublicKey;

  const verifySeals = useCallback(async (p: OpeningPackage) => {
    if (!p.files?.length) return;
    setSealChecking(true);
    const results: Record<string, "pending" | "ok" | "fail" | "unavailable"> = {};
    for (const f of p.files) {
      results[f.role] = "pending";
      setSealResults({ ...results });
      try {
        const res = await fetch(f.downloadUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const digest = await sha256Hex(bytes);
        if (digest === f.ciphertextSha256) {
          results[f.role] = "ok";
          cachedInnerRef.current[f.role] = { assetId: f.assetId, bytes };
        } else {
          results[f.role] = "fail";
        }
      } catch {
        results[f.role] = "unavailable";
      }
      setSealResults({ ...results });
    }
    setSealChecking(false);
  }, []);

  const pollPackage = useCallback(async () => {
    if (!isOpening || !submitted) return;
    try {
      const data = await getOpeningPackage(projectId);
      setIsDualTrack(true);
      setPkg(data);
      setPkgState("ready");
      setPkgError(null);
      // 文件集变化（assetId 序列）才重做密封核验——轮询幂等，避免重复下载大文件
      const key = (data?.files ?? []).map((f: any) => f.assetId).join(",");
      if (sealKeyRef.current !== key) {
        sealKeyRef.current = key;
        void verifySeals(data);
      }
    } catch (e: any) {
      const code = (e?.data as any)?.code;
      const msg = (e?.data as any)?.error;
      if (code === "NOT_DUAL_TRACK") {
        // 旧轨（单层信封）投递：由主持端代解密，本卡片隐藏并停止轮询
        setIsDualTrack(false);
        setPkgState("error");
        return;
      }
      if (code === "OUTER_NOT_DECRYPTED") {
        setPkgState("waiting");
        setPkg(null);
      } else {
        setPkgState("error");
      }
      setPkgError({ code: code ?? "", error: msg ?? "获取解密包失败" });
    }
  }, [isOpening, submitted, projectId, verifySeals]);

  useEffect(() => {
    const active = isOpening && submitted && isDualTrack !== false;
    if (active && !timerRef.current) {
      void pollPackage();
      timerRef.current = setInterval(() => { pollPackage().catch(() => {}); }, 10000);
    } else if (!active && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [isOpening, submitted, isDualTrack, pollPackage]);

  async function handleUkeyOpen() {
    if (!ukeyPassword) { toast.warning("请输入证书口令"); return; }
    setUkeyOpening(true);
    try {
      const uk = (await openUkey(ukeyPassword)).adapter;
      const certs = await uk.listCertificates();
      const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.publicKey === pubKeyRef.current);
      if (!cert) throw new Error("U盾内未找到与平台绑定的证书，请先到「U盾管理」页绑定或导入备份");
      setUkeyAdapter(uk);
      setUkeyCertSn(cert.certSn);
      setUkeyPassword("");
      setUkeyDialogVisible(false);
      toast.success(`U盾已解锁（${cert.certSn}）`);
    } catch (e: any) {
      toast.error(e?.message || "U盾解锁失败");
    } finally {
      setUkeyOpening(false);
    }
  }

  async function handleDecryptUpload() {
    if (!ukeyAdapter || !ukeyCertSn) { setUkeyDialogVisible(true); return; }
    const p = pkg;
    if (!p?.files?.length) { toast.warning("解密包未就绪，请等待外层解密完成"); return; }
    setDecrypting(true);
    setDecryptError("");
    try {
      setDecryptStage("U盾解密投标文件…");
      const FIELD_BY_ROLE: Record<string, string> = {
        technical: "file_technical", business: "file_business",
        coverLetter: "file_coverLetter", bond: "file_bond",
      };
      const form = new FormData();
      for (const f of p.files) {
        const cached = cachedInnerRef.current[f.role];
        let bytes: Uint8Array | null = cached && cached.assetId === f.assetId ? cached.bytes : null;
        if (!bytes) {
          const res = await fetch(f.downloadUrl, { credentials: "include" });
          if (!res.ok) throw new Error(`解密包下载失败（HTTP ${res.status}）`);
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        const kself = p.kselfByRole?.[f.role];
        if (!kself) throw new Error(`信封缺少「${ROLE_LABELS[f.role] ?? f.role}」供应商密钥件（kself）`);
        const dekJsonHex = await ukeyAdapter.decrypt(ukeyCertSn, kself);
        const dek = unwrapDekJson(hexToUtf8(dekJsonHex));
        const plainHex = sm4Decrypt(dek.keyHex, dek.ivHex, bytesToHex(bytes));
        form.append(FIELD_BY_ROLE[f.role], new File([hexToBytes(plainHex) as unknown as BlobPart], `${f.role}.plain`, { type: "application/octet-stream" }));
      }

      // 唱标字段密封件：U盾解 DEK_F → SM4 解 → {fields, nonce}；fieldsSha256 本地核验后随包上传
      setDecryptStage("揭示唱标字段（密封核验）…");
      const sf = p.sealedFields;
      if (!sf?.kself || !sf?.cipher) throw new Error("信封缺少唱标字段密封件");
      const dekFJsonHex = await ukeyAdapter.decrypt(ukeyCertSn, sf.kself);
      const dekF = unwrapDekJson(hexToUtf8(dekFJsonHex));
      const sealedJson = hexToUtf8(sm4Decrypt(dekF.keyHex, dekF.ivHex, sf.cipher));
      let payload: { fields: { price?: string; deliveryPeriod?: string; qualityCommitment?: string }; nonce: string };
      try {
        payload = JSON.parse(sealedJson);
        if (!payload?.fields || typeof payload.nonce !== "string") throw new Error("bad shape");
      } catch {
        throw new Error("唱标字段密封件解析失败（密封件损坏）");
      }
      if (sf.fieldsSha256) {
        const digest = await sha256Hex(canonicalJson(payload.fields));
        if (digest !== sf.fieldsSha256) throw new Error("唱标字段密封核验失败（fieldsSha256 不匹配，密封件可能被调包）");
      }
      form.append("fieldsJson", canonicalJson(payload.fields));
      form.append("nonce", payload.nonce);

      setDecryptStage("上传解密明文（完整性/承诺双闸校验）…");
      const res = await decryptUpload(projectId, form);
      if (res?.decryptStatus === "SUCCESS") {
        setRevealedFields({
          price: payload.fields.price ?? "",
          deliveryPeriod: payload.fields.deliveryPeriod ?? "",
          qualityCommitment: payload.fields.qualityCommitment ?? "",
        });
        toast.success("解密成功，唱标信息已提交，等待主持人核对");
        onDecrypted?.();
      } else {
        // 双闸失败：HTTP 200 + decryptStatus=DANGER —— 非 4xx，须读返回值判定
        const reason = res?.decryptError || "解密失败（完整性/承诺校验未通过）";
        setDecryptError(reason);
        toast.error(reason);
        onDecrypted?.();
      }
    } catch (e: any) {
      const msg = (e?.data as any)?.error || e?.message || "解密上传失败";
      setDecryptError(String(msg));
      // axios/fetch 层错误由全局 toast；本地解密错误在此提示
      if (!e?.data) toast.error(String(msg));
    } finally {
      setDecrypting(false);
      setDecryptStage("");
    }
  }

  if (!isOpening || !submitted || isDualTrack === false) return null;

  return (
    <div className="sp-module decrypt-card">
      <div className="sp-module-header">
        <h2 className="sp-module-title">解密我的投标</h2>
        <span className="sp-module-title" style={{ fontSize: 12, fontWeight: 500, color: "#8a96aa" }}>双层信封 · 每 10 秒自动刷新</span>
      </div>

      {pkgState !== "ready" ? (
        <>
          {pkgState === "waiting" && (
            <div className="ann-alert ann-alert--info"><span className="ann-alert-ico"><Info size={15} strokeWidth={2} /></span><div className="ann-alert-body"><span className="ann-alert-title">外层尚未解密，等待主持方解外层…</span></div></div>
          )}
          {pkgState === "error" && (
            <div className="ann-alert ann-alert--warning"><span className="ann-alert-ico"><TriangleAlert size={15} strokeWidth={2} /></span><div className="ann-alert-body"><span className="ann-alert-title">{(pkgError && (PKG_ERROR_TEXT[pkgError.code] || pkgError.error)) || "解密包暂不可用"}</span></div></div>
          )}
          {pkgState === "loading" && (
            <div className="ann-alert ann-alert--info"><span className="ann-alert-ico"><Info size={15} strokeWidth={2} /></span><div className="ann-alert-body"><span className="ann-alert-title">正在获取解密包…</span></div></div>
          )}
        </>
      ) : pkg ? (
        <>
          {/* 密封核验 */}
          <div className="seal-block">
            <div className="seal-title">密封核验 —— 本地重新计算投标文件密文的完整性校验值（SHA-256），与投递时存证值比对</div>
            {pkg.files.map((f) => (
              <div key={f.assetId} className="seal-row">
                <span className="seal-role">{ROLE_LABELS[f.role] ?? f.role}</span>
                {sealResults[f.role] === "ok" && <span className="sp-status approved"><ShieldCheck size={11} />密封完好</span>}
                {sealResults[f.role] === "fail" && <span className="sp-status rejected"><ShieldX size={11} />密封不符！请勿解密，联系主持人</span>}
                {sealResults[f.role] === "pending" && <span className="sp-status pending">核验中…</span>}
                {sealResults[f.role] === "unavailable" && <span className="sp-status disabled">无法核验（下载失败）</span>}
                {!sealResults[f.role] && <span className="sp-status disabled">未核验</span>}
              </div>
            ))}
            <SpButton variant="xs" disabled={sealChecking} onClick={() => verifySeals(pkg)}>重新核验密封</SpButton>
          </div>

          {revealedFields ? (
            <div className="ann-alert ann-alert--success">
              <span className="ann-alert-ico"><CircleCheck size={15} strokeWidth={2} /></span>
              <div className="ann-alert-body">
                <span className="ann-alert-title">解密成功，唱标字段已揭示并提交</span>
                <div className="revealed">
                  <span>报价：<b>{revealedFields.price}</b></span>
                  <span>工期：<b>{revealedFields.deliveryPeriod}</b></span>
                  <span>质量承诺：<b>{revealedFields.qualityCommitment}</b></span>
                </div>
                <div className="pkg-hint">等待主持人核对唱标信息，随后请在本页确认开标记录。</div>
              </div>
            </div>
          ) : (
            <>
              {decryptError && (
                <div className="ann-alert ann-alert--error" style={{ marginBottom: 10 }}>
                  <span className="ann-alert-ico"><CircleX size={15} strokeWidth={2} /></span>
                  <div className="ann-alert-body">
                    <span className="ann-alert-title">{decryptError}</span>
                    <div className="pkg-hint">解密失败已记录归因（投标人/平台/待裁决由主持人判定）。若为平台原因，可联系主持人「重置解密机会」后重试。</div>
                  </div>
                </div>
              )}
              <div className="ukey-row">
                {ukeyCertSn ? (
                  <span className="ukey-ok">U盾已解锁：{ukeyCertSn}</span>
                ) : (
                  <span className="ukey-hint">需使用投递时的 U盾证书（或导入的备份）解密</span>
                )}
                <SpButton variant="primary" loading={decrypting} disabled={sealChecking || !!pkg.paused} onClick={handleDecryptUpload}>
                  {decrypting ? (decryptStage || "解密中…") : "U盾解密并上传"}
                </SpButton>
              </div>
            </>
          )}
        </>
      ) : null}

      {/* U盾口令弹窗（口令仅内存持有，用后即清） */}
      <SpDialog
        open={ukeyDialogVisible}
        onClose={() => setUkeyDialogVisible(false)}
        title="U盾解密"
        subtitle="解密内层与揭示唱标字段需使用投递时的 U盾证书"
        icon={KeyRound}
        width={440}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setUkeyDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" loading={ukeyOpening} disabled={ukeyPresent === false} onClick={handleUkeyOpen}>解锁</SpButton>
          </>
        }
      >
        {ukeyPresent === false ? (
          <p style={{ fontSize: 13, color: "#e6a23c" }}>未检测到 U盾——请插入 U盾后重试（插入后自动恢复）</p>
        ) : (
        <>
        <p className="ukey-desc">请输入证书口令完成 U盾解锁。</p>
        <SpInput
          type="password"
          value={ukeyPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUkeyPassword(e.target.value)}
          placeholder="证书口令"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleUkeyOpen(); }}
        />
        <p className="ukey-hint mt-2">证书未绑定或 U盾遗失？前往 <Link href="/profile/ukey" className="text-[var(--brand)] font-semibold underline underline-offset-2">U盾管理</Link> 绑定或更换。</p>
        </>
        )}
      </SpDialog>
    </div>
  );
}
