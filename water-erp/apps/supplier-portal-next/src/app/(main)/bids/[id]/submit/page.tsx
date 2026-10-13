"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import { TriangleAlert, Check, X, Upload, Plus, Trash2, FolderPlus, CircleCheck,
  ArrowLeft, CircleX, Info,
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
import { serverNowMs, syncServerClock , formatBidPrice } from "@water-erp/shared";
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

// X-P2-04（2026-09-29）：本地「≥10000 视为元」启发式裸 ÷10000 已删——表单口径为万元
// （placeholder「如：1260」），≥1 亿元（≥10000 万元）报价会被折成「1.20 万元」差一万倍，
// 违反「万元↔元桥接只准经 shared format-bid.ts」铁律。改用 shared formatBidPrice(unitHint='万元')。

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
  const [nowMs, setNowMs] = useState(() => serverNowMs());

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
  // B4（第四波）：拆分模式三分类本地持久化——刷新/崩溃后文件引用（asset 元数据，可序列化）
  // 不再全丢须重新加密上传；提交成功即清（见 handleSubmit 成功分支）
  // 验收补（B4a）：键按用户隔离（同页草稿/DEK 键均 :userId 域——共用浏览器不得回填他人文件引用）；
  // profile 未就绪（id 未知）不读不写，避免 'anon' 键串档
  const splitStorageKey = profile?.id ? `sp:splitCats:${projectId}:${profile.id}` : null;
  useEffect(() => {
    if (!splitStorageKey) return;
    try {
      const raw = localStorage.getItem(splitStorageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Record<SplitKey, SplitCategory>;
        if (saved?.tech && saved?.biz && saved?.other) setSplitCats(saved);
      }
    } catch { /* 损坏即忽略，走空态 */ }
  }, [splitStorageKey]);
  useEffect(() => {
    if (!splitStorageKey) return;
    // 验收补（B4b）：剥离瞬态（uploading/progress）——上传中断电/刷新后恢复的 uploading:true
    // 曾把该分类上传按钮永久禁死（无复位路径），恰与 B4 要救的场景自相矛盾
    try {
      localStorage.setItem(splitStorageKey, JSON.stringify(splitCats, (k, v) =>
        k === 'uploading' || k === 'progress' ? undefined : v));
    } catch { /* 满/隐私模式忽略 */ }
  }, [splitCats, splitStorageKey]);

  const [autoSaveReady, setAutoSaveReady] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryTs, setRecoveryTs] = useState<number | null>(null);
  const [submitDialogVisible, setSubmitDialogVisible] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const draftKey = `bidsubmit:${projectId}:${profile?.userId || ''}`;
  const draft = useAutoSave(draftKey, form, { enabled: autoSaveReady });
  useLeaveGuard(draft.dirty);
  // SUP-P1-04（2026-09-29）：draftKey 首渲染时 profile 尚为 null（userId 段为空）——
  // 挂载 effect 闭包若直读 draftKey / draft 实例，会与 useAutoSave 内部（key 变化后
  // 重跑）写入的带 userId 键永不相交，恢复横幅成不可达死 UI。经 ref 取最新键与最新实例。
  const draftKeyRef = useRef(draftKey); draftKeyRef.current = draftKey;
  const draftApiRef = useRef(draft); draftApiRef.current = draft;

  // E2EE: localStorage key for DEK persistence (separate from form draft)
  const dekStorageKey = `supplier_dek:bidsubmit:${projectId}:${profile?.userId || ''}`;
  const dekKeyRef = useRef(dekStorageKey);
  dekKeyRef.current = dekStorageKey;

  function persistDeks(next: Record<string, ClientDek>) {
    try { localStorage.setItem(dekKeyRef.current, JSON.stringify(next)); } catch { /* ignore */ }
  }
  // Restore clientDeks from localStorage on mount
  function restoreDeks() {
    try {
      const raw = localStorage.getItem(dekKeyRef.current);
      if (raw) setClientDeks(JSON.parse(raw));
    } catch { /* ignore */ }
  }
  function clearDeks() {
    try { localStorage.removeItem(dekKeyRef.current); } catch { /* ignore */ }
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

  // E2EE: 加密并上传文件
  async function uploadEncryptedFile(
    file: File,
    catKey: string, // identifier for encrypting state
    onProgress: (pct: number) => void,
  ): Promise<FileAssetResponse> {
    setEncrypting((prev) => ({ ...prev, [catKey]: true }));
    try {
      // E2EE 旧轨：1. 计算原文哈希
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

  // 完整标书上传（E2EE 加密）
  async function handleFullBidUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setFullBidProgress(0);
    try {
      const res = await uploadEncryptedFile(file, "full", (pct) => setFullBidProgress(pct));
      updateForm({ fullBidFileAssetId: res.id });
      setFullBidMeta({ ...res, originalName: file.name, size: file.size } as FileAssetResponse);
      toast.success("文件加密上传成功");
    } catch { /* API 层已全局错误 toast */ }
    finally { setFullBidProgress(null); }
  }

  // 拆分文件上传（E2EE 加密）
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
      toast.success("文件加密上传成功");
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

  // 保证金上传
  async function handleBondUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setBondUploadProgress(0);
    try {
      const res = await uploadFile(file, "bid_document", (pct) => setBondUploadProgress(pct));
      updateForm({ bidBondAssetId: res.id });
      setBondFileMeta(res);
      toast.success("文件上传成功");
    } catch { /* API 层已全局错误 toast */ }
    finally { setBondUploadProgress(null); }
  }

  // 投标函文件上传（E2EE 加密）
  async function handleCoverLetterUpload(file: File) {
    if (file.size > maxUploadSize) { toast.error(`文件不能超过${maxUploadSizeMB}MB`); return; }
    setCoverLetterProgress(0);
    try {
      const res = await uploadEncryptedFile(file, "coverLetter", (pct) => setCoverLetterProgress(pct));
      updateForm({ coverLetterFileAssetId: res.id });
      setCoverLetterMeta({ ...res, originalName: file.name, size: file.size } as FileAssetResponse);
      toast.success("投标函文件加密上传成功");
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
          // 草稿/已提交记录读取失败须提示，否则用户以为没填过、重填后被 ALREADY_SUBMITTED 拦截。
          toast.warning("无法读取已保存的草稿/已提交记录；若您已提交过，请勿重复提交");
        }
        restoreDeks(); // E2EE: restore DEKs from previous session
        const ts = readDraftTs(draftKeyRef.current);
        if (draftApiRef.current.restoreDraft() && ts && (!subLocal || ts > new Date(subLocal.updatedAt).getTime())) {
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
    && new Date(project.deadline).getTime() > nowMs;
  const formDisabled = !canSubmit || existingSubmission?.status === "submitted";

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
      // 首次保存后进入草稿状态，使删除草稿按钮立即可用。
      if (existingSubmission?.status !== "submitted") {
        setExistingSubmission({ ...(existingSubmission ?? {}), status: "draft" });
      }
    } catch { /* API 层已全局错误 toast */ }
    finally { setSaving(false); }
  }

  // A-88：删除未递交的投标草稿（服务端草稿行 + 表单/本地缓存一并清；已提交须走撤回）
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
      draft.clearDraft(); // 本地自动草稿缓存（localStorage）
      clearDeks(); // E2EE DEK 缓存（localStorage）
      draft.markClean(); // 离开守卫复位
      toast.success("草稿已删除");
    } catch { /* API 层已全局错误 toast（服务端 error 文案，如 DRAFT_NOT_FOUND/DRAFT_NOT_DELETABLE） */ }
    finally { setDeleting(false); }
  }

  const preflightItems = (() => {
    const d = project?.deadline ? new Date(project.deadline) : null;
    const deadlineOk = !!(d && d.getTime() > nowMs);
    let fileOk = false;
    let fileDetail = "";
    if (submissionMode === "full") {
      fileOk = !!form.fullBidFileAssetId;
      fileDetail = fileOk ? "已上传" : "未上传";
    } else {
      const total = splitCats.tech.files.length + splitCats.biz.files.length + splitCats.other.files.length;
      fileOk = total > 0;
      // SUP-P1-01：明示参检口径——信封/评分管道只取每类第 1 个文件
      fileDetail = fileOk ? `已上传 ${total} 个文件（每类仅第 1 个参检）` : "未上传任何文件";
    }
    const items = [
      { label: "供应商资质", detail: isApproved ? "已入库，可投标" : "未通过审核，无法投标", ok: isApproved, required: true },
      { label: "投标报价", detail: form.bidPrice ? formatBidPrice(form.bidPrice, { prefix: "", unitHint: "万元" }) : "未填写", ok: !!form.bidPrice, required: true },
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
    await doSubmit();
  }

  async function doSubmit() {
    setSubmitting(true);
    try {
      // 旧轨：E2EE DEK 上传
      const payload = buildPayload();
      await supplierApi.submitBid(projectId, payload);
      draft.clearDraft();
      clearDeks();
      try { if (splitStorageKey) localStorage.removeItem(splitStorageKey); } catch { /* B4：提交成功清本地三分类（防下次误带旧引用） */ }
      toast.success("标书提交成功！");
      router.push("/my-bids");
    } catch (err: any) {
      // 信封组装等本地错误（throw Error）给出 message；其余（ALREADY_SUBMITTED 等）由 API 层全局 toast
      if (!(err?.status) && err?.message && !String(err?.message).includes("Request failed")) {
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
                <BAlert type="error" className="mb-5" title={!isApproved ? "供应商账号尚未通过审核，无法投标" : "该项目当前不可投标"} />
              )}
              {canSubmit && (
                <BAlert type="warning" className="mb-5" title={`投标截止：${project.deadline ? dayjs(project.deadline).format("YYYY年MM月DD日 HH:mm") : "--"}，请在截止前完成提交。`} />
              )}
              {showRecovery && (
                <BAlert
                  type="success"
                  className="mb-5"
                  title={`检测到本地草稿${recoveryTs ? "（" + dayjs(recoveryTs).format("HH:mm") + "）" : ""}，是否恢复？`}
                >
                  <div className="flex gap-3">
                    <SpButton variant="xs" onClick={acceptRecovery}>恢复草稿</SpButton>
                    <SpButton variant="xs" onClick={discardRecovery}>丢弃</SpButton>
                  </div>
                </BAlert>
              )}

              <SpPageHero title={project.name} />

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

                  {/* 提交模式选择 */}
                  <div className="b-form-item">
                    <label className="b-required">提交方式</label>
                    <div className="b-form-content">
                      <div className="mode-selector">
                        {/* SUP-P3-01：切换时清另一模式残留 assetId——buildPayload 恒 ...form，
                            切「拆分」后残留 fullBidFileAssetId 会被后端归到 technical 参检，
                            而信封按拆分口径不含该角色 → 隐晦 ENVELOPE_INCOMPLETE 拒收不指明根因 */}
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "full" ? "active is-active" : ""}`} onClick={() => { if (submissionMode !== "full") { setSubmissionMode("full"); setSplitCats((prev: any) => Object.fromEntries(Object.entries(prev).map(([k, v]: any) => [k, { ...v, files: [], uploading: false, progress: null }]))) as any; } }}>完整标书</button>
                        <button type="button" className={`neu-tab mode-tab ${submissionMode === "split" ? "active is-active" : ""}`} onClick={() => { if (submissionMode !== "split") { setSubmissionMode("split"); updateForm({ fullBidFileAssetId: "" } as any); setFullBidMeta(null); setFullBidProgress(null); } }}>拆分文件</button>
                      </div>
                    </div>
                  </div>

                  {/* 完整标书：单个文件 */}
                  {submissionMode === "full" && (
                    <div className="b-form-item">
                      <label className="b-required">标书文件</label>
                      <div className="b-form-content">
                        <div className="file-area">
                          <UploadZone accept=".pdf,.zip,.rar" disabled={formDisabled} onFile={handleFullBidUpload} label="上传完整标书" />
                          <span className="file-hint">PDF/ZIP（Office 请先转 PDF），≤{maxUploadSizeMB}MB</span>
                          {fullBidMeta ? (
                            <span className="file-chip">
                              {fullBidMeta.originalName}（{formatSize(fullBidMeta.size)}）
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => { updateForm({ fullBidFileAssetId: "" }); setFullBidMeta(null); }}>×</button>
                            </span>
                          ) : form.fullBidFileAssetId ? (
                            <span className="file-chip">
                              已上传
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => updateForm({ fullBidFileAssetId: "" })}>×</button>
                            </span>
                          ) : null}
                          {fullBidProgress !== null && <div className="w-[200px]"><SpProgress value={fullBidProgress} /></div>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 拆分文件：三个分类——每类仅第一个文件参检（collectDeclaredAssetIds/normalizeBidFileAssets
                      同口径取每类首个），达 1 个即停加并明示，消除多文件静默丢弃（SUP-P1-01） */}
                  {submissionMode === "split" && SPLIT_KEYS.map((cat) => (
                    <div className="b-form-item" key={cat}>
                      <label className={cat === "tech" ? "b-required" : undefined}>{splitCats[cat].label}</label>
                      <div className="b-form-content">
                        <div className="split-cat">
                          <div className="split-cat-head">
                            <AddFileButton
                              accept=".pdf,.zip,.rar"
                              disabled={formDisabled || splitCats[cat].uploading || splitCats[cat].files.length >= 1}
                              uploading={splitCats[cat].uploading}
                              onFile={(f) => handleSplitUpload(cat, f)}
                            />
                            <span className="file-hint">
                              {splitCats[cat].description} · PDF/ZIP（Office 请先转 PDF） · ≤{maxUploadSizeMB}MB
                              {splitCats[cat].files.length >= 1 ? " · 每类仅第一个文件参与评审与密封，多文件请合并后重新上传" : " · 每类仅第一个文件参检"}
                            </span>
                            {splitCats[cat].progress !== null && <div className="w-[120px]"><SpProgress value={splitCats[cat].progress} /></div>}
                          </div>
                          {splitCats[cat].files.length > 0 && (
                            <div className="split-files">
                              {splitCats[cat].files.map((f, idx) => (
                                <div key={f.id} className="split-file-row">
                                  <span className="split-file-name">{f.name}</span>
                                  <span className="split-file-size">{formatSize(f.size)}</span>
                                  <button type="button" className="neu-btn-xs is-danger" disabled={formDisabled} onClick={() => removeSplitFile(cat, idx)}>
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
                          <UploadZone accept=".pdf,.jpg,.png" disabled={formDisabled} onFile={handleBondUpload} label="上传保证金缴纳凭证" />
                          <span className="file-hint">银行回单/保函，PDF/JPG ≤{maxUploadSizeMB}MB</span>
                          {bondFileMeta ? (
                            <span className="file-chip">
                              {bondFileMeta.originalName}（{formatSize(bondFileMeta.size)}）
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => { updateForm({ bidBondAssetId: "" }); setBondFileMeta(null); }}>×</button>
                            </span>
                          ) : form.bidBondAssetId ? (
                            <span className="file-chip">
                              已上传
                              <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => updateForm({ bidBondAssetId: "" })}>×</button>
                            </span>
                          ) : null}
                          {bondUploadProgress !== null && <div className="w-[200px]"><SpProgress value={bondUploadProgress} /></div>}
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
                            <UploadZone accept=".pdf" disabled={formDisabled} onFile={handleCoverLetterUpload} label="上传投标函文件" />
                            <span className="file-hint">PDF（Office 请先转 PDF），≤{maxUploadSizeMB}MB</span>
                            {coverLetterMeta ? (
                              <span className="file-chip">
                                {coverLetterMeta.originalName}（{formatSize(coverLetterMeta.size)}）
                                <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => { updateForm({ coverLetterFileAssetId: "" }); setCoverLetterMeta(null); }}>×</button>
                              </span>
                            ) : form.coverLetterFileAssetId ? (
                              <span className="file-chip">
                                已上传
                                <button type="button" className="file-chip-remove" disabled={formDisabled} onClick={() => updateForm({ coverLetterFileAssetId: "" })}>×</button>
                              </span>
                            ) : null}
                            {coverLetterProgress !== null && <div className="w-[200px]"><SpProgress value={coverLetterProgress} /></div>}
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
          : <BAlert type="success" className="mt-4" title="检查通过，可以提交" />}
      </SpDialog>

      {/* A-88：删除草稿确认 */}
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
          将删除服务器端保存的草稿并清空当前表单，操作不可恢复。已正式提交的标书不可删除（撤回请在「我的投标」中操作）。
        </p>
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
