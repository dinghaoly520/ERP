"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import { TriangleAlert, Check, X, Upload, Plus, Trash2, CircleCheck,
  ArrowLeft, CircleX, Info, KeyRound,
} from "lucide-react";
import { bidApi } from "@/lib/api/bid";
import { supplierApi } from "@/lib/api/supplier";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { SpPageHero } from "@/components/sp-page-hero";
import { SpButton, SpInput, SpDialog, LoadingBlock } from "@/components/ui";
import { serverNowMs, syncServerClock, formatBidPrice } from "@water-erp/shared";
import * as scca from "@/utils/scca-ukey";
import { encryptAndUploadV3, nextRevisionContext } from "@/utils/dual-v3-client";
import type { V3Fields, V3Role } from "@water-erp/ukey";
import "@/styles/pages/bids.css";
import "@/styles/pages/shared.css"; // 跨页面共用的卡片与骨架屏样式。

/** el-alert 的原生等价（EP 四色调 + show-icon） */
function BAlert({ type, title, children, className }: {
  type: "info" | "warning" | "success" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = type === "error" ? CircleX : type === "warning" ? TriangleAlert : type === "success" ? CircleCheck : Info;
  return (
    <div className={`b-alert b-alert--${type}${className ? " " + className : ""}`}>
      <span className="b-alert-ico"><Icon size={15} strokeWidth={2} /></span>
      <div className="b-alert-body">
        {title !== undefined && <span className="b-alert-title">{title}</span>}
        {children}
      </div>
    </div>
  );
}

/** 招标文件上传拖放区（el-upload → 隐藏 file input + neu-drop-zone 触发器） */
function UploadZone({ accept, disabled, onFile, label }: {
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <div
        className={disabled ? "neu-drop-zone pointer-events-none opacity-50" : "neu-drop-zone"}
        onClick={() => !disabled && ref.current?.click()}
      >
        <Upload size={14} strokeWidth={1.75} />
        <span>{label}</span>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/** 拆分分类「添加文件」按钮（el-upload 触发器形态为按钮） */
function AddFileButton({ accept, disabled, onFile }: {
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="neu-btn-xs" disabled={disabled} onClick={() => !disabled && ref.current?.click()}>
        <Plus size={12} strokeWidth={2} />添加文件
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}

// ── dual-v3（SCCA）：文件本地暂存（选择不上传——加密与暂存上传在提交时由信封管线统一完成） ──

type SplitKey = "tech" | "biz" | "other";
const SPLIT_KEYS: SplitKey[] = ["tech", "biz", "other"];

interface SplitCat { label: string; description: string; file: File | null }
const EMPTY_SPLIT_CATS: Record<SplitKey, SplitCat> = {
  tech: { label: "技术方案", description: "技术方案、实施方案、质量控制等", file: null },
  biz: { label: "商务文件", description: "报价明细、资质证明、业绩案例等", file: null },
  other: { label: "其他材料", description: "补充说明、认证证书、授权函等", file: null },
};

interface BidForm {
  bidPrice: string;
  deliveryPeriod: string;
  qualityCommitment: string;
}
const EMPTY_FORM: BidForm = { bidPrice: "", deliveryPeriod: "", qualityCommitment: "" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** SCCA 投递上下文（capabilities + 状态 + 管理证装配；未就绪时 sccaReason 给指引） */
interface SccaContext {
  supplierId: string;
  signingBindingId: string;
  signingCertFingerprint: string;
  adminCert: { adminCertId: string; publicKey: string };
}

function BidSubmitInner() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const sp = useSearchParams();
  // 保留来源上下文（from=list 表示从可投标项目进入），返回时正确还原
  const fromList = sp.get("from") === "list";

  const maxUploadSizeMB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB) || 50;
  const maxUploadSize = maxUploadSizeMB * 1024 * 1024;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState("");
  const [project, setProject] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [nowMs, setNowMs] = useState(() => serverNowMs());

  // 提交模式：full=完整标书，split=拆分文件
  const [submissionMode, setSubmissionMode] = useState<"full" | "split">("full");

  const [form, setForm] = useState<BidForm>(EMPTY_FORM);
  const updateForm = (patch: Partial<BidForm>) => setForm((prev) => ({ ...prev, ...patch }));

  // 本地暂存文件（dual-v3：提交时统一双层加密）
  const [fullBidFile, setFullBidFile] = useState<File | null>(null);
  const [splitCats, setSplitCats] = useState<Record<SplitKey, SplitCat>>({
    tech: { ...EMPTY_SPLIT_CATS.tech },
    biz: { ...EMPTY_SPLIT_CATS.biz },
    other: { ...EMPTY_SPLIT_CATS.other },
  });
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [bondFile, setBondFile] = useState<File | null>(null);

  // U盾 PIN（提交时用；绝不缓存/落盘）
  const [pin, setPin] = useState("");

  // 已有投递记录（已递交禁改；revision 作 CAS 基线）
  const [existingSubmission, setExistingSubmission] = useState<any>(null);

  // SCCA 上下文（capabilities 门控）
  const [sccaCtx, setSccaCtx] = useState<SccaContext | null>(null);
  const [sccaReason, setSccaReason] = useState<string | null>(null);

  const [submitDialogVisible, setSubmitDialogVisible] = useState(false);

  const isApproved = profile?.status === "APPROVED";
  const canSubmit = !!project && isApproved
    && ["DOWNLOAD", "SUBMIT"].includes(project.stage)
    && new Date(project.deadline).getTime() > nowMs;
  const formDisabled = !canSubmit || existingSubmission?.status === "submitted" || submitting;

  // 离开守卫：任何已填字段或已暂存文件（无草稿机制——刷新/离开即丢失，须确认）
  const dirty = !!(form.bidPrice || form.deliveryPeriod || form.qualityCommitment
    || fullBidFile || splitCats.tech.file || splitCats.biz.file || splitCats.other.file
    || coverLetterFile || bondFile || pin);
  useLeaveGuard(dirty, "当前有未提交的投标内容，离开后会丢失。确定离开吗？");

  function backToDetail() {
    router.push(fromList ? `/bids/${projectId}?from=list` : `/bids/${projectId}`);
  }

  // ── 本地暂存（选择文件即暂存，不上传） ──
  function handleFullBidStage(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setFullBidFile(file);
  }
  function handleSplitStage(cat: SplitKey, file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setSplitCats((prev) => ({ ...prev, [cat]: { ...prev[cat], file } }));
  }
  function handleCoverLetterStage(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setCoverLetterFile(file);
  }
  function handleBondStage(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setBondFile(file);
  }

  // 初始加载：项目 + 供应商档案 + 已有投递记录 + SCCA 上下文装配
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, prof, sub] = await Promise.all([
          bidApi.getProject(projectId),
          supplierApi.getProfile(),
          supplierApi.getBidSubmission(projectId).catch(() => null),
        ]);
        if (cancelled) return;
        setProject(p);
        setProfile(prof);
        if (p && !["DOWNLOAD", "SUBMIT"].includes(p.stage)) {
          toast.warning("该项目当前不在投标阶段");
          router.push(`/bids/${projectId}`);
          return;
        }
        if (sub) {
          setExistingSubmission(sub);
          // 文本字段回填（legacy 草稿/记录的报价等仍可用；文件引用不可恢复——v3 加密重新选）
          setForm({
            bidPrice: sub.bidPrice || "",
            deliveryPeriod: sub.deliveryPeriod || "",
            qualityCommitment: sub.qualityCommitment || "",
          });
        }
        // SCCA 上下文（capabilities 门控：allowedEnvelopeVersions 含 dual-v3 + ACTIVE CA 绑定）
        try {
          const [caps, status, adminCert] = await Promise.all([
            supplierApi.caCapabilities(),
            supplierApi.getStatus(),
            supplierApi.getAdminCert(),
          ]);
          if (cancelled) return;
          const allowed = Array.isArray((caps as any)?.allowedEnvelopeVersions)
            && (caps as any).allowedEnvelopeVersions.includes("dual-v3");
          const binding = (caps as any)?.activeBinding;
          const fingerprint: unknown = binding?.signingCert?.sha256Fingerprint;
          if (!allowed) {
            setSccaReason("平台尚未开放 dual-v3 投递通道（灰度中），请联系管理员");
          } else if (!binding || binding.kind !== "ca" || typeof fingerprint !== "string") {
            setSccaReason("请先在「证书与U盾」页绑定 SCCA CA 证书后再投递");
          } else if (!(status as any)?.id) {
            setSccaReason("供应商身份信息获取失败，请刷新重试");
          } else {
            setSccaCtx({
              supplierId: (status as any).id,
              signingBindingId: binding.id ?? "",
              signingCertFingerprint: fingerprint,
              adminCert: { adminCertId: adminCert.adminCertId, publicKey: adminCert.publicKey },
            });
          }
        } catch {
          setSccaReason("CA 能力查询失败，请刷新重试");
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void syncServerClock().then(() => setNowMs(serverNowMs()));
    const timer = window.setInterval(() => setNowMs(serverNowMs()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function retryLoad() {
    setError(false);
    setLoading(true);
    try {
      const [p, prof] = await Promise.all([bidApi.getProject(projectId), supplierApi.getProfile()]);
      setProject(p);
      setProfile(prof);
      try {
        const sub: any = await supplierApi.getBidSubmission(projectId);
        if (sub) {
          setExistingSubmission(sub);
          setForm({
            bidPrice: sub.bidPrice || "",
            deliveryPeriod: sub.deliveryPeriod || "",
            qualityCommitment: sub.qualityCommitment || "",
          });
        }
      } catch { /* ignore */ }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const preflightItems = (() => {
    const d = project?.deadline ? new Date(project.deadline) : null;
    const deadlineOk = !!(d && d.getTime() > nowMs);
    let fileOk = false;
    let fileDetail = "";
    if (submissionMode === "full") {
      fileOk = !!fullBidFile;
      fileDetail = fileOk ? `${fullBidFile!.name}（${formatSize(fullBidFile!.size)}）` : "未选择";
    } else {
      const total = (splitCats.tech.file ? 1 : 0) + (splitCats.biz.file ? 1 : 0) + (splitCats.other.file ? 1 : 0);
      fileOk = total > 0;
      fileDetail = fileOk ? `已选择 ${total} 类文件（每类仅第 1 个参检）` : "未选择任何文件";
    }
    const items = [
      { label: "供应商资质", detail: isApproved ? "已入库，可投标" : "未通过审核，无法投标", ok: isApproved, required: true },
      { label: "投标报价", detail: form.bidPrice ? formatBidPrice(form.bidPrice, { prefix: "", unitHint: "万元" }) : "未填写", ok: !!form.bidPrice, required: true },
      { label: "交货工期", detail: form.deliveryPeriod || "未填写", ok: !!form.deliveryPeriod, required: true },
      { label: "质量承诺", detail: form.qualityCommitment || "未填写", ok: !!form.qualityCommitment, required: false },
      { label: submissionMode === "full" ? "完整标书文件" : "拆分标书文件", detail: fileDetail, ok: fileOk, required: true },
      { label: "U盾 PIN", detail: pin ? "已输入（提交时用于盾签名）" : "未输入", ok: !!pin, required: true },
    ];
    if (project?.bondRequired) {
      items.push({ label: "投标保证金凭证", detail: bondFile ? "已选择" : "未选择", ok: !!bondFile, required: true });
    }
    items.push({ label: "投标截止", detail: d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "未知", ok: deadlineOk, required: true });
    return items;
  })();

  const canConfirm = preflightItems.every((i) => i.ok || !i.required);

  async function confirmSubmit() {
    setSubmitDialogVisible(false);
    await doSubmit();
  }

  /** dual-v3 投递管线：本地暂存 → 双层加密+暂存上传 → prepare → 盾 P7 签名 → submit v3 */
  async function doSubmit() {
    if (!sccaCtx) return;
    setSubmitting(true);
    try {
      // ① 盾枚举（容器 + 加密证 PEM）
      setSubmitNote("正在读取 U盾…");
      const certs = await scca.listSccaCerts();
      const first = certs[0];
      if (!first) throw new Error("U盾内未找到证书——请插入 SCCA CA U盾并启动证书助手");
      const encCertPem = first.enc?.pem;
      if (!encCertPem) throw new Error("U盾证书缺少加密证（enc.pem）");
      await scca.loginScca(first.container, pin);

      // ② 角色装配（镜像后端 normalizeBidFileAssets 口径：完整→technical；拆分 tech/biz/other
      //    →technical/business/coverLetter；投标函文件优先占 coverLetter；bond 仅保证金项目）
      const roleFiles: Array<{ role: V3Role; file: File }> = [];
      if (submissionMode === "full") {
        if (fullBidFile) roleFiles.push({ role: "technical", file: fullBidFile });
      } else {
        if (splitCats.tech.file) roleFiles.push({ role: "technical", file: splitCats.tech.file });
        if (splitCats.biz.file) roleFiles.push({ role: "business", file: splitCats.biz.file });
        if (!coverLetterFile && splitCats.other.file) roleFiles.push({ role: "coverLetter", file: splitCats.other.file });
      }
      if (coverLetterFile) roleFiles.push({ role: "coverLetter", file: coverLetterFile });
      if (project?.bondRequired && bondFile) roleFiles.push({ role: "bond", file: bondFile });

      // ③ 双层加密 + 暂存上传 + 信封组装（信封 revision=当前+1——服务端按 ===newRev 硬校验）
      setSubmitNote("正在双层加密并暂存密文…");
      const fields: V3Fields = {
        price: form.bidPrice, amountUnit: "万元", currency: "CNY",
        deliveryPeriod: form.deliveryPeriod, qualityCommitment: form.qualityCommitment,
      };
      const baseRevision = (existingSubmission as any)?.revision ?? 0;
      const { envelope } = await encryptAndUploadV3(
        projectId, roleFiles, fields, encCertPem, {
          wrapKeyToEncCert: (pem, json) => scca.wrapSccaKey(pem, json),
        }, sccaCtx.adminCert, {
          uploadOuter: (role, blob, filename) => supplierApi.caUploadEncryptedOuter(projectId, blob, filename)
            .then((r) => ({ fileAssetId: r.fileAssetId, outerSha256: r.outerSha256, outerBytes: r.outerBytes })),
        },
        nextRevisionContext({
          supplierId: sccaCtx.supplierId,
          submissionId: existingSubmission?.id ?? "",
          revision: baseRevision,
          signingBindingId: sccaCtx.signingBindingId,
          signingCertFingerprint: sccaCtx.signingCertFingerprint,
        }),
      );

      // ④ 冻结签名原文 → 盾 P7 签名
      setSubmitNote("盾签名信封原文（P7）…");
      const prep = await supplierApi.caPrepare(projectId, "submit");
      const frozen = await supplierApi.caSigningPayload(projectId, prep.operationId, envelope);
      const signP7 = await scca.signSccaP7(first.container, frozen.canonical);

      // ⑤ 提交（v3 轨）
      setSubmitNote("提交投递…");
      await supplierApi.submitBid(projectId, {
        operationId: prep.operationId,
        signatureFormat: "scca-pkcs7-base64",
        signP7,
        baseRevision,
      });
      toast.success("标书提交成功（dual-v3 双信封 + 盾 P7 签名）！");
      router.push("/my-bids");
    } catch (err: any) {
      // 信封组装/盾操作等本地错误（无 status）给 message；API 错误由全局 toast
      if (!(err?.status) && err?.message && !String(err?.message).includes("Request failed")) {
        toast.error(err.message);
      }
    } finally {
      setSubmitting(false);
      setSubmitNote("");
    }
  }

  return (
    <div className="page-container">
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <button type="button" className="neu-link back-link" onClick={backToDetail}>
            <ArrowLeft size={14} strokeWidth={1.85} />返回项目详情
          </button>
          {error ? (
            <div className="sp-error-block">
              <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
              <div className="sp-error-text">数据加载失败</div>
              <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
              <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
            </div>
          ) : project ? (
            <>
              {!canSubmit && (
                <BAlert type="error" className="mb-5" title={!isApproved ? "供应商账号尚未通过审核，无法投标" : "该项目当前不可投标"} />
              )}
              {canSubmit && (
                <BAlert type="warning" className="mb-5" title={`投标截止：${project.deadline ? dayjs(project.deadline).format("YYYY年MM月DD日 HH:mm") : "--"}，请在截止前完成提交。`} />
              )}
              {sccaReason && canSubmit && (
                <BAlert type="error" className="mb-5" title={sccaReason}>
                  <div className="mt-1 text-xs">本页投递采用 SCCA CA 双层信封（dual-v3）：标书文件由平台与贵司 U盾双层加密，信封由盾 P7 签名。</div>
                </BAlert>
              )}

              <SpPageHero title={project.name} />
              <div className="b-form-card">
                <div className="b-form-section">
                  <div className="b-form-item">
                    <label className="b-required">投标报价</label>
                    <div className="b-form-content">
                      <div className="b-inp-group">
                        <input
                          type="number"
                          min={0}
                          value={form.bidPrice}
                          disabled={formDisabled}
                          onChange={(e) => updateForm({ bidPrice: e.target.value })}
                          placeholder="报价金额（万元），如：1260"
                        />
                        <span className="b-inp-addon">万元</span>
                      </div>
                    </div>
                  </div>
                  <div className="b-form-item">
                    <label className="b-required">交货/工期</label>
                    <div className="b-form-content">
                      <SpInput value={form.deliveryPeriod} disabled={formDisabled} onChange={(e) => updateForm({ deliveryPeriod: e.target.value })} placeholder="例如：120日历天" />
                    </div>
                  </div>
                  <div className="b-form-item">
                    <label>质量承诺</label>
                    <div className="b-form-content">
                      <SpInput value={form.qualityCommitment} disabled={formDisabled} onChange={(e) => updateForm({ qualityCommitment: e.target.value })} placeholder="选填，如：满足招标文件要求，一次验收合格" />
                    </div>
                  </div>

                  {/* 提交模式选择 */}
                  <div className="b-form-item">
                    <label className="b-required">提交方式</label>
                    <div className="b-form-content">
                      <div className="mode-selector">
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "full" ? "active is-active" : ""}`} onClick={() => { if (submissionMode !== "full") { setSubmissionMode("full"); setSplitCats({ tech: { ...EMPTY_SPLIT_CATS.tech }, biz: { ...EMPTY_SPLIT_CATS.biz }, other: { ...EMPTY_SPLIT_CATS.other } }); } }}>完整标书</button>
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "split" ? "active is-active" : ""}`} onClick={() => { if (submissionMode !== "split") { setSubmissionMode("split"); setFullBidFile(null); } }}>拆分文件</button>
                      </div>
                    </div>
                  </div>

                  {/* 完整标书：单个文件（本地暂存——提交时统一双层加密） */}
                  {submissionMode === "full" && (
                    <div className="b-form-item">
                      <label className="b-required">标书文件</label>
                      <div className="b-form-content">
                        <div className="file-area">
                          <UploadZone accept=".pdf,.zip,.rar" disabled={formDisabled} onFile={handleFullBidStage} label="选择完整标书" />
                          <span className="file-hint">PDF/ZIP（Office 请先转 PDF），≤{maxUploadSizeMB}MB · 提交时由 U盾双层加密</span>
                          {fullBidFile && (
                            <span className="file-chip">
                              {fullBidFile.name}（{formatSize(fullBidFile.size)}）
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => setFullBidFile(null)}>×</button>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 拆分文件：三个分类——每类仅第一个文件参检（与后端 normalize 口径一致） */}
                  {submissionMode === "split" && SPLIT_KEYS.map((cat) => (
                    <div className="b-form-item" key={cat}>
                      <label className={cat === "tech" ? "b-required" : undefined}>{splitCats[cat].label}</label>
                      <div className="b-form-content">
                        <div className="split-cat">
                          <div className="split-cat-head">
                            <AddFileButton
                              accept=".pdf,.zip,.rar"
                              disabled={formDisabled || !!splitCats[cat].file}
                              onFile={(f) => handleSplitStage(cat, f)}
                            />
                            <span className="file-hint">
                              {splitCats[cat].description} · PDF/ZIP（Office 请先转 PDF） · ≤{maxUploadSizeMB}MB · 每类仅第 1 个文件参检
                            </span>
                          </div>
                          {splitCats[cat].file && (
                            <div className="split-files">
                              <div className="split-file-row">
                                <span className="split-file-name">{splitCats[cat].file!.name}</span>
                                <span className="split-file-size">{formatSize(splitCats[cat].file!.size)}</span>
                                <button type="button" className="neu-btn-xs is-danger" disabled={formDisabled} onClick={() => setSplitCats((prev) => ({ ...prev, [cat]: { ...prev[cat], file: null } }))}>
                                  <Trash2 size={11} strokeWidth={1.75} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* 保证金 */}
                  {project?.bondRequired && (
                    <div className="b-form-item">
                      <label className="b-required">保证金凭证</label>
                      <div className="b-form-content">
                        <div className="file-area">
                          <UploadZone accept=".pdf,.jpg,.png" disabled={formDisabled} onFile={handleBondStage} label="选择保证金缴纳凭证" />
                          <span className="file-hint">银行回单/保函，PDF/JPG ≤{maxUploadSizeMB}MB · 提交时随信封加密</span>
                          {bondFile && (
                            <span className="file-chip">
                              {bondFile.name}（{formatSize(bondFile.size)}）
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => setBondFile(null)}>×</button>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 投标函（文件模式——dual-v3 信封仅承载文件角色，文字投标函已随旧轨移除） */}
                  <div className="b-form-item">
                    <label>投标函</label>
                    <div className="b-form-content">
                      <div className="file-area">
                        <UploadZone accept=".pdf" disabled={formDisabled} onFile={handleCoverLetterStage} label="选择投标函文件" />
                        <span className="file-hint">PDF（Office 请先转 PDF），≤{maxUploadSizeMB}MB · 选填</span>
                        {coverLetterFile && (
                          <span className="file-chip">
                            {coverLetterFile.name}（{formatSize(coverLetterFile.size)}）
                            <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => setCoverLetterFile(null)}>×</button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {canSubmit && existingSubmission?.status !== "submitted" && (
                  <div className="submit-actions">
                    {/* U盾 PIN（提交时盾签名用——绝不缓存/落盘） */}
                    <div className="b-inp-group" style={{ width: 220 }}>
                      <KeyRound size={13} strokeWidth={1.75} className="ml-2 shrink-0 text-[var(--fg-3)]" />
                      <input
                        type="password"
                        value={pin}
                        disabled={formDisabled}
                        autoComplete="off"
                        onChange={(e) => setPin(e.target.value)}
                        placeholder="U盾 PIN"
                        className="w-full bg-transparent px-2 py-1.5 text-sm outline-none"
                      />
                    </div>
                    <SpButton
                      variant="primary"
                      loading={submitting}
                      icon={CircleCheck}
                      disabled={!sccaCtx}
                      onClick={() => setSubmitDialogVisible(true)}
                      title="标书文件由 U盾双层加密，开标时供应商自解；信封由盾 P7 签名"
                    >
                      {submitting ? "提交中..." : "正式提交标书"}
                    </SpButton>
                    {submitNote && <span className="auto-save-hint">{submitNote}</span>}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </>
      )}

      {/* 提交前检查弹窗 */}
      <SpDialog open={submitDialogVisible} onClose={() => setSubmitDialogVisible(false)} title="提交前检查" width={500}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setSubmitDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" disabled={!canConfirm} onClick={confirmSubmit}>确认提交</SpButton>
          </>
        }
      >
        <div className="preflight-list">
          {preflightItems.map((item) => (
            <div key={item.label} className="preflight-item">
              <span className={`preflight-icon ${item.ok ? "green" : item.required ? "red" : "orange"}`}>
                {item.ok ? <Check size={14} strokeWidth={2} /> : item.required ? <X size={14} strokeWidth={2} /> : <TriangleAlert size={13} strokeWidth={1.75} />}
              </span>
              <div className="preflight-text">
                <span className="preflight-label">{item.label}</span>
                <span className="preflight-detail">{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
        {!canConfirm
          ? <BAlert type="error" className="mt-4" title="存在未通过的必填项，请完善后重新提交" />
          : <BAlert type="success" className="mt-4" title="检查通过——确认后开始双层加密与盾签名（请勿关闭页面）" />}
      </SpDialog>
    </div>
  );
}

/** 提交标书（SCCA dual-v3：本地暂存 → 提交时双层加密+盾 P7 签名；useSearchParams 需 Suspense 包裹） */
export default function BidSubmitPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BidSubmitInner />
    </Suspense>
  );
}
