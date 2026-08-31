"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  Send, TriangleAlert, Check, X, Upload, Plus, Trash2, FolderPlus, CircleCheck,
  ArrowLeft, CircleX, Info, KeyRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { bidApi } from "@/lib/api/bid";
import { supplierApi } from "@/lib/api/supplier";
import { uploadFile, type FileAssetResponse } from "@/lib/api/upload";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { SpPageHero } from "@/components/sp-page-hero";
import { SpButton, SpInput, SpTextarea, SpDialog, SpProgress, LoadingBlock } from "@/components/ui";
import {
  generateDEK, encryptFile, formatDEK, computePlaintextHash, packageEncryptedFile,
  type ClientDek,
} from "@/utils/bid-crypto";
import { type EnvelopeFileEntry, type EnvelopeRole, type UKeyAdapter } from "@water-erp/ukey";
import { openUkey } from "@/utils/ukey-factory";
import { encryptAndUploadFile, buildEnvelope, type AdminCertRef } from "@/utils/dual-envelope";
import "@/styles/pages/bids.css";

/** el-alert 的原生等价（EP 四色调 + show-icon） */
function BAlert({ type, title, children, style }: {
  type: "info" | "warning" | "success" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const Icon = type === "error" ? CircleX : type === "warning" ? TriangleAlert : type === "success" ? CircleCheck : Info;
  return (
    <div className={`b-alert b-alert--${type}`} style={style}>
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
        className="neu-drop-zone"
        style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
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
function AddFileButton({ accept, disabled, uploading, onFile }: {
  accept: string;
  disabled?: boolean;
  uploading?: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="neu-btn-xs" disabled={disabled} onClick={() => !disabled && ref.current?.click()}>
        <Plus size={12} strokeWidth={2} />{uploading ? "上传中..." : "添加文件"}
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

// 拆分文件条目
interface FileEntry { id: string; name: string; size: number }
interface SplitCategory { label: string; description: string; files: FileEntry[]; uploading: boolean; progress: number | null }
type SplitKey = "tech" | "biz" | "other";
const SPLIT_KEYS: SplitKey[] = ["tech", "biz", "other"];

interface BidForm {
  bidPrice: string;
  deliveryPeriod: string;
  qualityCommitment: string;
  fullBidFileAssetId: string; // 完整标书模式
  coverLetter: string;
  coverLetterFileAssetId: string; // 投标函文件
  bidBondAssetId: string;
}

const EMPTY_FORM: BidForm = {
  bidPrice: "",
  deliveryPeriod: "",
  qualityCommitment: "",
  fullBidFileAssetId: "",
  coverLetter: "",
  coverLetterFileAssetId: "",
  bidBondAssetId: "",
};

/** 拆分文件三分类的空态（初始/删除草稿后复位共用） */
const EMPTY_SPLIT_CATS: Record<SplitKey, SplitCategory> = {
  tech: { label: "技术方案", description: "技术方案、实施方案、质量控制等", files: [], uploading: false, progress: null },
  biz: { label: "商务文件", description: "报价明细、资质证明、业绩案例等", files: [], uploading: false, progress: null },
  other: { label: "其他材料", description: "补充说明、认证证书、授权函等", files: [], uploading: false, progress: null },
};

const DRAFT_PREFIX = "supplier_draft:";

/** 读取本地草稿的存储时间戳（与 useAutoSave 的落盘格式一致；挂载期同步可读） */
function readDraftTs(key: string): number | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.ts === "number" ? parsed.ts : null;
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// bidPrice 存为字符串，可能以万元或元为单位。≥10000 视为元自动换算。
function formatBidPrice(raw: string | number | null | undefined): string {
  const n = Number(raw);
  if (!raw || isNaN(n)) return "未填写";
  if (n >= 10000) return `${(n / 10000).toFixed(2)} 万元`;
  return `${n} 万元`;
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
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  // 提交模式：full=完整标书，split=拆分文件
  const [submissionMode, setSubmissionMode] = useState<"full" | "split">("full");
  // 投标函模式：text=文字输入，file=上传文件
  const [coverLetterMode, setCoverLetterMode] = useState<"text" | "file">("text");

  const [form, setForm] = useState<BidForm>(EMPTY_FORM);
  const updateForm = (patch: Partial<BidForm>) => setForm((prev) => ({ ...prev, ...patch }));

  // E2EE: 存储每个文件的 DEK（assetId → {keyHex, ivHex, authTagHex}）
  const [clientDeks, setClientDeks] = useState<Record<string, ClientDek>>({});
  // E2EE: 加密阶段指示器（UPLOADING 时显示进度条，ENCRYPTING 时显示「正在加密…」）
  const [encrypting, setEncrypting] = useState<Record<string, boolean>>({});

  // ═══ 双信封 v2（dual-v2 新轨）状态 ═══
  // 双层加密密封条目缓存：assetId → { role, entry{sha256,kself,kadmin}, certPublicKey }（全部公开信息，无私钥）
  // certPublicKey 记录上传时所用证书公钥——提交前与签名证书比对，拦截换证窗口期 kself/签名错位
  const [dualEntries, setDualEntries] = useState<Record<string, { role: EnvelopeRole; entry: EnvelopeFileEntry; certPublicKey: string }>>({});
  const DUAL_STORAGE_KEY = `supplier_dual:bidsubmit:${projectId}`;
  const dualKeyRef = useRef(DUAL_STORAGE_KEY);
  dualKeyRef.current = DUAL_STORAGE_KEY;
  // 管理方加密证书（getAdminCert，惰性缓存）
  const adminCertRef = useRef<AdminCertRef | null>(null);
  // U盾会话（仅内存持有介质实例与所选证书，口令不落任何持久存储）
  const [ukeyAdapter, setUkeyAdapter] = useState<UKeyAdapter | null>(null);
  const [ukeyCertSn, setUkeyCertSn] = useState("");
  const [ukeyCertPublicKey, setUkeyCertPublicKey] = useState("");
  const [ukeyPassword, setUkeyPassword] = useState("");
  const [ukeyOpening, setUkeyOpening] = useState(false);
  const [ukeyDialogVisible, setUkeyDialogVisible] = useState(false);
  const pendingSubmitRef = useRef(false);
  /** U盾会话快照 ref——解锁后同一事件闭包内立即 doSubmit，useState 异步更新会读到空值（Vue ref 语义的 React 等价物） */
  const ukeySessionRef = useRef<{ adapter: UKeyAdapter; certSn: string; certPublicKey: string } | null>(null);
  /** 是否已绑定 U盾证书（profile.sm2PublicKey 由 bindCert 回填）→ 走双层加密新轨；否则保留传统 E2EE 旧轨 */
  const dualReady = !!profile?.sm2PublicKey;
  /** 前端文件分类 → 信封角色（与服务端 normalizeBidFileAssets 的契约镜像） */
  const ROLE_BY_CAT: Record<string, EnvelopeRole> = {
    full: "technical", "split-tech": "technical", "split-biz": "business",
    "split-other": "coverLetter", coverLetter: "coverLetter",
  };
  /** 本地缓存的绑定证书序列号（U盾管理页绑定成功后写入；仅公开信息） */
  function boundCertSn(): string {
    try {
      const raw = localStorage.getItem("supplier_ukey_bound");
      return raw ? (JSON.parse(raw)?.certSn ?? "") : "";
    } catch { return ""; }
  }
  async function getAdminCertCached(): Promise<AdminCertRef> {
    if (adminCertRef.current) return adminCertRef.current;
    const c: any = await supplierApi.getAdminCert();
    adminCertRef.current = c;
    return c;
  }
  function persistDual(next: Record<string, { role: EnvelopeRole; entry: EnvelopeFileEntry; certPublicKey: string }>) {
    try { localStorage.setItem(dualKeyRef.current, JSON.stringify(next)); } catch { /* ignore */ }
  }
  function setDualEntriesAndPersist(updater: (prev: Record<string, { role: EnvelopeRole; entry: EnvelopeFileEntry; certPublicKey: string }>) => Record<string, { role: EnvelopeRole; entry: EnvelopeFileEntry; certPublicKey: string }>) {
    setDualEntries((prev) => { const next = updater(prev); persistDual(next); return next; });
  }

  const [existingSubmission, setExistingSubmission] = useState<any>(null);
  const [fullBidMeta, setFullBidMeta] = useState<FileAssetResponse | null>(null);
  const [fullBidProgress, setFullBidProgress] = useState<number | null>(null);
  const [coverLetterMeta, setCoverLetterMeta] = useState<FileAssetResponse | null>(null);
  const [coverLetterProgress, setCoverLetterProgress] = useState<number | null>(null);
  const [bondFileMeta, setBondFileMeta] = useState<FileAssetResponse | null>(null);
  const [bondUploadProgress, setBondUploadProgress] = useState<number | null>(null);

  const [splitCats, setSplitCats] = useState<Record<SplitKey, SplitCategory>>({
    tech: { ...EMPTY_SPLIT_CATS.tech },
    biz: { ...EMPTY_SPLIT_CATS.biz },
    other: { ...EMPTY_SPLIT_CATS.other },
  });

  const [autoSaveReady, setAutoSaveReady] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryTs, setRecoveryTs] = useState<number | null>(null);
  const [submitDialogVisible, setSubmitDialogVisible] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const draftKey = `bidsubmit:${projectId}`;
  const draft = useAutoSave(draftKey, form, { enabled: autoSaveReady });
  useLeaveGuard(draft.dirty);

  const heroSub = project
    ? `${project.projectCode} · ${project.procurementMethod} · 截止 ${project.deadline ? dayjs(project.deadline).format("MM-DD HH:mm") : "--"}`
    : "";

  // E2EE: localStorage key for DEK persistence (separate from form draft)
  const dekStorageKey = `supplier_dek:bidsubmit:${projectId}`;
  const dekKeyRef = useRef(dekStorageKey);
  dekKeyRef.current = dekStorageKey;

  function persistDeks(next: Record<string, ClientDek>) {
    try { localStorage.setItem(dekKeyRef.current, JSON.stringify(next)); } catch { /* ignore */ }
  }
  // Restore clientDeks / dualEntries from localStorage on mount
  function restoreDeks() {
    try {
      const raw = localStorage.getItem(dekKeyRef.current);
      if (raw) setClientDeks(JSON.parse(raw));
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(dualKeyRef.current);
      if (raw) setDualEntries(JSON.parse(raw));
    } catch { /* ignore */ }
  }
  function clearDeks() {
    try { localStorage.removeItem(dekKeyRef.current); } catch { /* ignore */ }
    try { localStorage.removeItem(dualKeyRef.current); } catch { /* ignore */ }
  }

  function backToDetail() {
    router.push(fromList ? `/bids/${projectId}?from=list` : `/bids/${projectId}`);
  }

  function acceptRecovery() {
    const d = draft.restoreDraft() as Partial<BidForm> | null;
    if (d) setForm((prev) => ({ ...prev, ...d }));
    restoreDeks();
    setShowRecovery(false);
  }
  function discardRecovery() {
    draft.clearDraft();
    clearDeks();
    setShowRecovery(false);
  }

  // ── E2EE: 加密并上传文件 ──
  async function uploadEncryptedFile(
    file: File,
    catKey: string, // identifier for encrypting state
    onProgress: (pct: number) => void,
  ): Promise<FileAssetResponse> {
    setEncrypting((prev) => ({ ...prev, [catKey]: true }));
    try {
      if (dualReady) {
        // ═══ 新轨：M → C_inner(SM4/DEK_S) → C_outer(SM4/DEK_A) → 上传，entry 入信封缓存 ═══
        const role = ROLE_BY_CAT[catKey];
        if (!role) throw new Error("未知文件类别，无法双层密封");
        const admin = await getAdminCertCached();
        const res = await encryptAndUploadFile(
          file, role,
          { certSn: boundCertSn(), publicKey: profile.sm2PublicKey },
          admin, onProgress,
        );
        setDualEntriesAndPersist((prev) => ({ ...prev, [res.assetId]: { role: res.role, entry: res.entry, certPublicKey: profile.sm2PublicKey } }));
        return res.upload;
      }
      // ═══ 旧轨（未绑定 U盾证书）：E2EE 加密，行为不变 ═══
      // 1. 计算原文哈希
      const plaintextSha256 = await computePlaintextHash(file);
      // 2. 生成 DEK
      const { rawKey, keyHex, iv } = await generateDEK();
      // 3. 加密
      const { encryptedBlob, dek } = await encryptFile(file, rawKey, iv);
      dek.keyHex = keyHex;
    // 4. 包装并上传密文
    const encryptedFile = packageEncryptedFile(encryptedBlob, file.name);
    const res = await uploadFile(encryptedFile, "bid_document", onProgress, true, plaintextSha256);
    // 5. 存储 DEK
    setClientDeks((prev) => {
      const next = { ...prev, [res.id]: dek };
      persistDeks(next);
      return next;
    });
    return res;
    } finally {
      setEncrypting((prev) => ({ ...prev, [catKey]: false }));
    }
  }

  // ── 完整标书上传（E2EE 加密）──
  async function handleFullBidUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setFullBidProgress(0);
    try {
      const res = await uploadEncryptedFile(file, "full", (pct) => setFullBidProgress(pct));
      updateForm({ fullBidFileAssetId: res.id });
      setFullBidMeta({ ...res, originalName: file.name, size: file.size } as FileAssetResponse);
      toast.success(dualReady ? "文件已双层加密上传" : "文件加密上传成功");
    } catch { /* API 层已全局错误 toast */ }
    finally { setFullBidProgress(null); }
  }

  // ── 拆分文件上传（E2EE 加密）──
  async function handleSplitUpload(catKey: SplitKey, file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setSplitCats((prev) => ({ ...prev, [catKey]: { ...prev[catKey], uploading: true, progress: 0 } }));
    try {
      const res = await uploadEncryptedFile(file, `split-${catKey}`, (pct) => {
        setSplitCats((prev) => ({ ...prev, [catKey]: { ...prev[catKey], progress: pct } }));
      });
      setSplitCats((prev) => ({
        ...prev,
        [catKey]: { ...prev[catKey], files: [...prev[catKey].files, { id: res.id, name: file.name, size: file.size }] },
      }));
      toast.success(dualReady ? "文件已双层加密上传" : "文件加密上传成功");
    } catch { /* API 层已全局错误 toast */ }
    finally {
      setSplitCats((prev) => ({ ...prev, [catKey]: { ...prev[catKey], uploading: false, progress: null } }));
    }
  }

  function removeSplitFile(catKey: SplitKey, index: number) {
    setSplitCats((prev) => ({
      ...prev,
      [catKey]: { ...prev[catKey], files: prev[catKey].files.filter((_, i) => i !== index) },
    }));
  }

  // ── 保证金上传 ──
  async function handleBondUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setBondUploadProgress(0);
    try {
      if (dualReady) {
        // 新轨：保证金凭证同双层密封（服务端 bondRequired 时逐角色参检）
        const admin = await getAdminCertCached();
        const res = await encryptAndUploadFile(
          file, "bond",
          { certSn: boundCertSn(), publicKey: profile.sm2PublicKey },
          admin, (pct) => setBondUploadProgress(pct),
        );
        setDualEntriesAndPersist((prev) => ({ ...prev, [res.assetId]: { role: res.role, entry: res.entry, certPublicKey: profile.sm2PublicKey } }));
        updateForm({ bidBondAssetId: res.assetId });
        setBondFileMeta(res.upload);
        toast.success("保证金凭证已双层加密上传");
      } else {
        const res = await uploadFile(file, "bid_document", (pct) => setBondUploadProgress(pct));
        updateForm({ bidBondAssetId: res.id });
        setBondFileMeta(res);
        toast.success("文件上传成功");
      }
    } catch { /* API 层已全局错误 toast */ }
    finally { setBondUploadProgress(null); }
  }

  // ── 投标函文件上传（E2EE 加密）──
  async function handleCoverLetterUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setCoverLetterProgress(0);
    try {
      const res = await uploadEncryptedFile(file, "coverLetter", (pct) => setCoverLetterProgress(pct));
      updateForm({ coverLetterFileAssetId: res.id });
      setCoverLetterMeta({ ...res, originalName: file.name, size: file.size } as FileAssetResponse);
      toast.success(dualReady ? "投标函已双层加密上传" : "投标函文件加密上传成功");
    } catch { /* API 层已全局错误 toast */ }
    finally { setCoverLetterProgress(null); }
  }

  // 初始加载：项目 + 供应商档案 + 已有草稿/提交记录 + 本地草稿恢复提示
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let subLocal: any = null;
      try {
        const [p, prof] = await Promise.all([bidApi.getProject(projectId), supplierApi.getProfile()]);
        if (cancelled) return;
        setProject(p);
        setProfile(prof);
        if (p && !["DOWNLOAD", "SUBMIT"].includes(p.stage)) {
          toast.warning("该项目当前不在投标阶段");
          router.push(`/bids/${projectId}`); // 草稿保存后的跳转保留原逻辑
          return;
        }
        try {
          const sub: any = await supplierApi.getBidSubmission(projectId);
          if (cancelled) return;
          if (sub) {
            subLocal = sub;
            setExistingSubmission(sub);
            setForm({
              bidPrice: sub.bidPrice || "",
              deliveryPeriod: sub.deliveryPeriod || "",
              qualityCommitment: sub.qualityCommitment || "",
              fullBidFileAssetId: sub.fullBidFileAssetId || "",
              coverLetter: sub.coverLetter || "",
              coverLetterFileAssetId: sub.coverLetterFileAssetId || "",
              bidBondAssetId: sub.bidBondAssetId || "",
            });
          }
        } catch {
          // P1：草稿/已提交记录读取失败须提示，否则用户以为没填过、重填后被 ALREADY_SUBMITTED 拦截。
          toast.warning("无法读取已保存的草稿/已提交记录；若您已提交过，请勿重复提交");
        }
        restoreDeks(); // E2EE: restore DEKs / dual entries from previous session
        // 预热管理方加密证书（新轨上传/提交需要；失败在上传时按需重试并报错）
        if (profile?.sm2PublicKey) getAdminCertCached().catch(() => {});
        const ts = readDraftTs(draftKey);
        if (draft.restoreDraft() && ts && (!subLocal || ts > new Date(subLocal.updatedAt).getTime())) {
          setRecoveryTs(ts);
          setShowRecovery(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAutoSaveReady(true);
          draft.markClean();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
            fullBidFileAssetId: sub.fullBidFileAssetId || "",
            coverLetter: sub.coverLetter || "",
            coverLetterFileAssetId: sub.coverLetterFileAssetId || "",
            bidBondAssetId: sub.bidBondAssetId || "",
          });
        }
      } catch { /* ignore */ }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const isApproved = profile?.status === "APPROVED";
  const canSubmit = !!project && isApproved
    && ["DOWNLOAD", "SUBMIT"].includes(project.stage)
    && new Date(project.deadline) > new Date();
  const formDisabled = !canSubmit || existingSubmission?.status === "submitted";
  /** A-90 方案a（2026-08-31）：旧轨投递 UI 退役——未绑盾且可投递时仅显示绑盾引导卡（双信封为唯一交互投递通道）；已递交状态展示区保留原样 */
  const legacyRetired = canSubmit && !dualReady && existingSubmission?.status !== "submitted";

  // 构建 clientDeks 映射（根据当前表单中的 assetId 查找 DEK）
  // ═══ 双信封 v2：按服务端声明口径收集本次提交的已声明资产 ═══
  // （镜像 normalizeBidFileAssets：full→technical；split tech→technical / biz→business /
  //  other→coverLetter（仅 coverLetterFileAssetId 未用时的首个）；投标函与 bond 单独参检）
  function collectDeclaredAssetIds(): string[] {
    const ids: string[] = [];
    if (submissionMode === "full") {
      if (form.fullBidFileAssetId) ids.push(form.fullBidFileAssetId);
    } else {
      const first = (v: FileEntry[] | undefined) => v?.[0]?.id;
      const t = first(splitCats.tech.files); if (t) ids.push(t);
      const b = first(splitCats.biz.files); if (b) ids.push(b);
      if (!form.coverLetterFileAssetId) { const o = first(splitCats.other.files); if (o) ids.push(o); }
    }
    if (form.coverLetterFileAssetId) ids.push(form.coverLetterFileAssetId);
    if (project?.bondRequired && form.bidBondAssetId) ids.push(form.bidBondAssetId);
    return ids;
  }

  /** 已声明资产 → 信封条目（缺条目时由提交前校验拦截，防 ENVELOPE_INCOMPLETE 拒收） */
  function collectDeclaredEntries(): Partial<Record<EnvelopeRole, EnvelopeFileEntry>> {
    const out: Partial<Record<EnvelopeRole, EnvelopeFileEntry>> = {};
    for (const id of collectDeclaredAssetIds()) {
      const e = dualEntries[id];
      if (e) out[e.role] = e.entry;
    }
    return out;
  }

  /** 组装 dual-v2 信封 + 供应商证书签名 */
  async function buildDualEnvelope() {
    const session = ukeySessionRef.current;
    if (!session) throw new Error("U盾未解锁，请先插入 U盾并输入证书口令");
    // 换证窗口期拦截——条目缺失或上传时所用证书公钥 ≠ 当前签名证书公钥，
    // 说明存在用旧证书加密的条目（kself 用旧公钥，服务端只验 sha256/签名会放行，开标解密才爆），
    // 一律要求重新加密上传，不提交。
    const changed = collectDeclaredAssetIds().filter((id) => {
      const rec = dualEntries[id];
      return !rec || rec.certPublicKey !== session.certPublicKey;
    });
    if (changed.length > 0) {
      throw new Error("U盾证书已更换或文件密封件缺失（可能在其他浏览器上传），请重新加密上传投标文件后再提交");
    }
    const admin = await getAdminCertCached();
    return buildEnvelope({
      entries: collectDeclaredEntries(),
      fields: {
        price: form.bidPrice,
        deliveryPeriod: form.deliveryPeriod,
        qualityCommitment: form.qualityCommitment || "",
      },
      ukey: session.adapter,
      certSn: session.certSn,
      certPublicKey: session.certPublicKey,
      adminCertId: admin.adminCertId,
    });
  }

  // ═══ U盾会话（提交时开锁，仅内存持有；口令不持久化）═══
  async function handleUkeyOpen() {
    if (!ukeyPassword) { toast.warning("请输入证书口令"); return; }
    setUkeyOpening(true);
    try {
      const uk = (await openUkey(ukeyPassword)).adapter;
      const certs = await uk.listCertificates();
      // 选中平台已绑定证书：优先本地缓存的 certSn（U盾管理页绑定后写入），兜底按公钥匹配 profile.sm2PublicKey
      const profilePub = profile?.sm2PublicKey;
      const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.publicKey === profilePub);
      if (!cert) throw new Error("U盾内未找到与平台绑定的证书，请先到「U盾管理」页绑定");
      setUkeyAdapter(uk);
      setUkeyCertSn(cert.certSn);
      setUkeyCertPublicKey(cert.publicKey);
      ukeySessionRef.current = { adapter: uk, certSn: cert.certSn, certPublicKey: cert.publicKey };
      setUkeyPassword("");
      setUkeyDialogVisible(false);
      toast.success(`U盾已解锁（${cert.certSn}）`);
      if (pendingSubmitRef.current) { pendingSubmitRef.current = false; await doSubmit(); }
    } catch (e: any) {
      toast.error(e?.message || "U盾解锁失败");
    } finally {
      setUkeyOpening(false);
    }
  }

  function buildClientDeksPayload(): Record<string, string> {
    const result: Record<string, string> = {};
    const assetIds: string[] = [];
    if (submissionMode === "full") {
      if (form.fullBidFileAssetId) assetIds.push(form.fullBidFileAssetId);
    } else {
      for (const cat of SPLIT_KEYS) {
        for (const f of splitCats[cat].files) assetIds.push(f.id);
      }
    }
    if (form.coverLetterFileAssetId) assetIds.push(form.coverLetterFileAssetId);
    for (const id of assetIds) {
      const dek = clientDeks[id];
      if (dek) result[id] = formatDEK(dek.keyHex, dek.ivHex, dek.authTagHex);
    }
    return result;
  }

  function buildPayload() {
    const payload: any = { ...form, clientDeks: buildClientDeksPayload() };
    if (submissionMode === "split") {
      payload.splitFiles = {
        tech: splitCats.tech.files,
        biz: splitCats.biz.files,
        other: splitCats.other.files,
      };
    }
    return payload;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await supplierApi.saveBidDraft(projectId, buildPayload());
      toast.success("草稿已保存");
      // A-88 验收补：首次保存后即进入草稿态，删除草稿按钮无需刷新即可见
      if (existingSubmission?.status !== "submitted") {
        setExistingSubmission({ ...(existingSubmission ?? {}), status: "draft" });
      }
    } catch { /* API 层已全局错误 toast */ }
    finally { setSaving(false); }
  }

  // ── A-88：删除未递交的投标草稿（服务端草稿行 + 表单/本地缓存一并清；已提交须走撤回）──
  async function confirmDeleteDraft() {
    setDeleteDialogVisible(false);
    setDeleting(true);
    try {
      await api.delete(`/supplier-portal/bid-submissions/${projectId}/draft`);
      setExistingSubmission(null); // 回读 submission 置空（「草稿」徽标消失）
      setForm(EMPTY_FORM); // 清空表单各字段
      setFullBidMeta(null);
      setCoverLetterMeta(null);
      setBondFileMeta(null);
      setSplitCats({
        tech: { ...EMPTY_SPLIT_CATS.tech },
        biz: { ...EMPTY_SPLIT_CATS.biz },
        other: { ...EMPTY_SPLIT_CATS.other },
      });
      setClientDeks({});
      setDualEntries({});
      draft.clearDraft(); // 本地自动草稿缓存（localStorage）
      clearDeks(); // E2EE DEK / 双层信封条目缓存（localStorage）
      draft.markClean(); // 离开守卫复位
      toast.success("草稿已删除");
    } catch { /* API 层已全局错误 toast（服务端 error 文案，如 DRAFT_NOT_FOUND/DRAFT_NOT_DELETABLE） */ }
    finally { setDeleting(false); }
  }

  const preflightItems = (() => {
    const d = project?.deadline ? new Date(project.deadline) : null;
    const deadlineOk = !!(d && d > new Date());
    let fileOk = false;
    let fileDetail = "";
    if (submissionMode === "full") {
      fileOk = !!form.fullBidFileAssetId;
      fileDetail = fileOk ? "已上传" : "未上传";
    } else {
      const total = splitCats.tech.files.length + splitCats.biz.files.length + splitCats.other.files.length;
      fileOk = total > 0;
      fileDetail = fileOk ? `已上传 ${total} 个文件` : "未上传任何文件";
    }
    const items = [
      { label: "供应商资质", detail: isApproved ? "已入库，可投标" : "未通过审核，无法投标", ok: isApproved, required: true },
      { label: "U盾证书", detail: dualReady ? (ukeyAdapter ? `已解锁（${ukeyCertSn}）` : "已绑定，提交时校验证书口令") : "未绑定（请先绑定 U盾）", ok: true, required: false },
      { label: "投标报价", detail: dualReady ? "密封进双层信封（开标时揭示）" : formatBidPrice(form.bidPrice), ok: !!form.bidPrice, required: true },
      { label: "交货工期", detail: form.deliveryPeriod || "未填写", ok: !!form.deliveryPeriod, required: true },
      { label: "质量承诺", detail: form.qualityCommitment || "未填写", ok: !!form.qualityCommitment, required: false },
      { label: submissionMode === "full" ? "完整标书文件" : "拆分标书文件", detail: fileDetail, ok: fileOk, required: true },
    ];
    if (project?.bondRequired) {
      items.push({ label: "投标保证金凭证", detail: form.bidBondAssetId ? "已上传" : "未上传", ok: !!form.bidBondAssetId, required: true });
    }
    items.push({ label: "投标截止", detail: d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "未知", ok: deadlineOk, required: true });
    return items;
  })();

  const canConfirm = preflightItems.every((i) => i.ok || !i.required);

  async function confirmSubmit() {
    setSubmitDialogVisible(false);
    // 新轨：需 U盾签名——未开锁先弹口令对话框，开锁成功后继续提交
    if (dualReady && !ukeyAdapter) {
      pendingSubmitRef.current = true;
      setUkeyDialogVisible(true);
      return;
    }
    await doSubmit();
  }

  async function doSubmit() {
    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (dualReady) {
        // 新轨：报价只经 sealedFields 密封上送——顶层 payload 剔除明文 bidPrice
        delete payload.bidPrice;
        const { envelope, signature } = await buildDualEnvelope();
        payload.envelope = envelope;
        payload.signature = signature;
      } else {
        // 旧轨：E2EE DEK 上传（envelope 不传即旧行为）
        payload.clientDeks = buildClientDeksPayload();
      }
      const submitted = await supplierApi.submitBid(projectId, payload);
      draft.clearDraft();
      clearDeks();
      // W11-①（A-101）：双信封轨投递成功后自动签回执（U盾私钥 SM2 签 canonical，服务端验签存档）
      // 失败不阻塞投递结果——提示可稍后在「我的投标」补签
      if (dualReady && ukeyAdapter && ukeyCertSn && submitted?.id) {
        try {
          const { canonical } = await supplierApi.getReceiptPayload(submitted.id);
          const signature = await ukeyAdapter.sign(ukeyCertSn, canonical);
          await supplierApi.signReceiptSignature(submitted.id, signature);
          toast.success("投标回执已签署存档（SM2 防抵赖）");
        } catch (e: unknown) {
          toast.error("回执签署未完成：" + ((e as Error)?.message || "可稍后补签"));
        }
      }
      // U盾保管提示仅在双层加密轨展示
      toast.success(dualReady
        ? "标书提交成功！请妥善保管 U盾备份文件，开标解密与唱标核对需要。"
        : "标书提交成功！");
      router.push("/my-bids");
    } catch (err: any) {
      const code = err?.data?.code;
      if (dualReady && code === "ADMIN_CERT_CHANGED") {
        // 管理方证书轮换——页面级缓存失效并重拉；
        // 已上传条目的 kadmin 仍加密于旧管理方公钥，必须整体重传（不能自动重试同批次）
        adminCertRef.current = null;
        try { await getAdminCertCached(); } catch { /* 下次上传再拉 */ }
        toast.error("管理方加密证书已轮换，请重新加密上传全部投标文件后再提交");
      }
      // 其余错误（ALREADY_SUBMITTED 等）由 API 层全局 toast；信封组装错误（throw Error）给出 message
      else if (!(err?.status) && err?.message && !String(err?.message).includes("Request failed")) {
        toast.error(err.message);
      }
    } finally { setSubmitting(false); }
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
                <BAlert type="error" style={{ marginBottom: 20 }} title={!isApproved ? "供应商账号尚未通过审核，无法投标" : "该项目当前不可投标"} />
              )}
              {canSubmit && (
                <BAlert type="warning" style={{ marginBottom: 20 }} title={`投标截止：${project.deadline ? dayjs(project.deadline).format("YYYY年MM月DD日 HH:mm") : "--"}，请在截止前完成提交。`} />
              )}
              {canSubmit && dualReady && (
                <BAlert type="success" style={{ marginBottom: 20 }} title="双层加密信封投递：文件将双层加密上传，报价等唱标字段密封至开标时揭示。提交时需插入 U盾并输入证书口令完成签名。" />
              )}
              {showRecovery && (
                <BAlert
                  type="success"
                  style={{ marginBottom: 20 }}
                  title={`检测到本地草稿${recoveryTs ? "（" + dayjs(recoveryTs).format("HH:mm") + "）" : ""}，是否恢复？`}
                >
                  <div style={{ display: "flex", gap: 12 }}>
                    <SpButton variant="xs" onClick={acceptRecovery}>恢复草稿</SpButton>
                    <SpButton variant="xs" onClick={discardRecovery}>丢弃</SpButton>
                  </div>
                </BAlert>
              )}

              <SpPageHero icon={Send} title={project.name} sub={heroSub} />

              {/* ═══ A-90 方案a：未绑盾——旧轨上传/投递 UI 退役，仅显示绑盾引导卡（API/应急 flag 原样保留）═══ */}
              {legacyRetired && (
                <div className="neu-card detail-card">
                  <div className="card-header">
                    <span className="card-title">投标须使用 U盾数字证书</span>
                  </div>
                  <BAlert type="warning" title="双信封加密投递为唯一投递通道，传统加密通道已停止受理。">
                    投标文件须以双层 SM4 加密上传，报价等唱标字段经 SM2 证书签名密封，开标时解密揭示。
                  </BAlert>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, marginTop: 20 }}>
                    <SpButton variant="primary" icon={KeyRound} onClick={() => router.push("/profile/ukey")}>前往绑定 U盾</SpButton>
                    <span className="file-hint">绑定后本页自动切换为双信封投递。</span>
                    <span className="file-hint">已保存的草稿字段（报价/工期等）在绑定后可直接回读；已上传的加密文件需重新上传。</span>
                  </div>
                </div>
              )}
              {!legacyRetired && (
              <div className="neu-card detail-card">
                <div className="card-header">
                  <span className="card-title">标书信息</span>
                  {existingSubmission && (
                    <span className={`b-tag ${existingSubmission.status === "draft" ? "b-tag--info" : "b-tag--success"}`}>
                      {existingSubmission.status === "draft" ? "草稿" : "已提交"}
                    </span>
                  )}
                </div>

                <div className={`b-form${formDisabled ? " is-disabled" : ""}`}>
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

                  {/* ═══ 提交模式选择 ═══ */}
                  <div className="b-form-item">
                    <label className="b-required">提交方式</label>
                    <div className="b-form-content">
                      <div className="mode-selector">
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "full" ? "active is-active" : ""}`} onClick={() => setSubmissionMode("full")}>完整标书</button>
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "split" ? "active is-active" : ""}`} onClick={() => setSubmissionMode("split")}>拆分文件</button>
                      </div>
                    </div>
                  </div>

                  {/* ═══ 完整标书：单个文件 ═══ */}
                  {submissionMode === "full" && (
                    <div className="b-form-item">
                      <label className="b-required">标书文件</label>
                      <div className="b-form-content">
                        <div className="file-area">
                          <UploadZone accept=".pdf,.doc,.docx,.zip,.rar" disabled={!canSubmit} onFile={handleFullBidUpload} label="上传完整标书" />
                          <span className="file-hint">PDF/DOC/ZIP，≤{maxUploadSizeMB}MB</span>
                          {fullBidMeta ? (
                            <span className="file-chip">
                              {fullBidMeta.originalName}（{formatSize(fullBidMeta.size)}）
                              <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => { updateForm({ fullBidFileAssetId: "" }); setFullBidMeta(null); }}>×</button>
                            </span>
                          ) : form.fullBidFileAssetId ? (
                            <span className="file-chip">
                              已上传
                              <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => updateForm({ fullBidFileAssetId: "" })}>×</button>
                            </span>
                          ) : null}
                          {fullBidProgress !== null && <div style={{ width: 200 }}><SpProgress value={fullBidProgress} /></div>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══ 拆分文件：三个分类，每类多文件 ═══ */}
                  {submissionMode === "split" && SPLIT_KEYS.map((cat) => (
                    <div className="b-form-item" key={cat}>
                      <label className={cat === "tech" ? "b-required" : undefined}>{splitCats[cat].label}</label>
                      <div className="b-form-content">
                        <div className="split-cat">
                          <div className="split-cat-head">
                            <AddFileButton
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.png"
                              disabled={!canSubmit || splitCats[cat].uploading}
                              uploading={splitCats[cat].uploading}
                              onFile={(f) => handleSplitUpload(cat, f)}
                            />
                            <span className="file-hint">{splitCats[cat].description} · ≤{maxUploadSizeMB}MB</span>
                            {splitCats[cat].progress !== null && <div style={{ width: 120 }}><SpProgress value={splitCats[cat].progress} /></div>}
                          </div>
                          {splitCats[cat].files.length > 0 && (
                            <div className="split-files">
                              {splitCats[cat].files.map((f, idx) => (
                                <div key={f.id} className="split-file-row">
                                  <span className="split-file-name">{f.name}</span>
                                  <span className="split-file-size">{formatSize(f.size)}</span>
                                  <button type="button" className="neu-btn-xs is-danger" disabled={!canSubmit} onClick={() => removeSplitFile(cat, idx)}>
                                    <Trash2 size={11} strokeWidth={1.75} />
                                  </button>
                                </div>
                              ))}
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
                          <UploadZone accept=".pdf,.jpg,.png" disabled={!canSubmit} onFile={handleBondUpload} label="上传保证金缴纳凭证" />
                          <span className="file-hint">银行回单/保函，PDF/JPG ≤{maxUploadSizeMB}MB</span>
                          {bondFileMeta ? (
                            <span className="file-chip">
                              {bondFileMeta.originalName}（{formatSize(bondFileMeta.size)}）
                              <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => { updateForm({ bidBondAssetId: "" }); setBondFileMeta(null); }}>×</button>
                            </span>
                          ) : form.bidBondAssetId ? (
                            <span className="file-chip">
                              已上传
                              <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => updateForm({ bidBondAssetId: "" })}>×</button>
                            </span>
                          ) : null}
                          {bondUploadProgress !== null && <div style={{ width: 200 }}><SpProgress value={bondUploadProgress} /></div>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 投标函 */}
                  <div className="b-form-item">
                    <label>投标函</label>
                    <div className="b-form-content">
                      <div className="cover-letter-section">
                        <div className="mode-selector mb-3">
                          <button type="button" className={`neu-tab mode-tab ${coverLetterMode === "text" ? "active is-active" : ""}`} onClick={() => setCoverLetterMode("text")}>文字输入</button>
                          <button type="button" className={`neu-tab mode-tab ${coverLetterMode === "file" ? "active is-active" : ""}`} onClick={() => setCoverLetterMode("file")}>上传文件</button>
                        </div>
                        {coverLetterMode === "text" ? (
                          <SpTextarea rows={4} value={form.coverLetter} disabled={formDisabled} onChange={(e) => updateForm({ coverLetter: e.target.value })} placeholder="请输入投标函内容（选填）" />
                        ) : (
                          <div className="file-area">
                            <UploadZone accept=".pdf,.doc,.docx" disabled={!canSubmit} onFile={handleCoverLetterUpload} label="上传投标函文件" />
                            <span className="file-hint">PDF/DOC，≤{maxUploadSizeMB}MB</span>
                            {coverLetterMeta ? (
                              <span className="file-chip">
                                {coverLetterMeta.originalName}（{formatSize(coverLetterMeta.size)}）
                                <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => { updateForm({ coverLetterFileAssetId: "" }); setCoverLetterMeta(null); }}>×</button>
                              </span>
                            ) : form.coverLetterFileAssetId ? (
                              <span className="file-chip">
                                已上传
                                <button type="button" className="file-chip-remove" disabled={!canSubmit} onClick={() => updateForm({ coverLetterFileAssetId: "" })}>×</button>
                              </span>
                            ) : null}
                            {coverLetterProgress !== null && <div style={{ width: 200 }}><SpProgress value={coverLetterProgress} /></div>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {canSubmit && existingSubmission?.status !== "submitted" && (
                  <div className="submit-actions">
                    {draft.lastSavedAt && dayjs(draft.lastSavedAt).isValid() && (
                      <span className="auto-save-hint">已自动保存 {dayjs(draft.lastSavedAt).format("HH:mm")}</span>
                    )}
                    <SpButton loading={saving} icon={FolderPlus} onClick={saveDraft}>保存草稿</SpButton>
                    {existingSubmission?.status === "draft" && (
                      <SpButton danger loading={deleting} icon={Trash2} onClick={() => setDeleteDialogVisible(true)}>删除草稿</SpButton>
                    )}
                    <SpButton
                      variant="primary"
                      loading={submitting}
                      icon={CircleCheck}
                      onClick={() => setSubmitDialogVisible(true)}
                      title="标书文件由系统加密存储，开标时由主持人解密"
                    >
                      {submitting ? "提交中..." : "正式提交标书"}
                    </SpButton>
                  </div>
                )}
              </div>
              )}
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
          ? <BAlert type="error" style={{ marginTop: 16 }} title="存在未通过的必填项，请完善后重新提交" />
          : <BAlert type="success" style={{ marginTop: 16 }} title="检查通过，可以提交" />}
      </SpDialog>

      {/* ═══ A-88：删除草稿确认 ═══ */}
      <SpDialog open={deleteDialogVisible} onClose={() => setDeleteDialogVisible(false)} title="删除草稿" width={420}
        icon={Trash2}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setDeleteDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" danger onClick={confirmDeleteDraft}>确认删除</SpButton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--fg-2)]">
          将删除服务器端保存的投标草稿，并清空当前表单与本地缓存，该操作不可恢复。已正式提交的标书不可删除（如需撤回请在「我的投标」中操作）。
        </p>
      </SpDialog>

      {/* ═══ U盾口令对话框（dual-v2 提交签名）═══ */}
      <SpDialog
        open={ukeyDialogVisible}
        onClose={() => setUkeyDialogVisible(false)}
        title="证书口令验证"
        subtitle="提交双层加密标书需解锁 U盾证书"
        icon={KeyRound}
        width={420}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setUkeyDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" loading={ukeyOpening} onClick={handleUkeyOpen}>解锁并提交</SpButton>
          </>
        }
      >
        <label className="reg-label">证书口令</label>
        <SpInput
          type="password"
          value={ukeyPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUkeyPassword(e.target.value)}
          placeholder="输入证书口令"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleUkeyOpen(); }}
        />
        <p className="text-xs mt-3 text-[var(--fg-2)]">口令仅本次会话使用，不会保存。</p>
      </SpDialog>
    </div>
  );
}

/** 提交标书（客户端 E2EE 加密上传 + 本地草稿自动保存 + 离开守卫；useSearchParams 需 Suspense 包裹） */
export default function BidSubmitPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BidSubmitInner />
    </Suspense>
  );
}
