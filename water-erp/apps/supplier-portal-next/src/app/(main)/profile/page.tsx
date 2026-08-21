"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  Briefcase,
  Building2,
  Copy,
  Folder,
  ImageUp,
  Landmark,
  Paperclip,
  PenLine,
  Phone,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { uploadFile } from "@/lib/api/upload";
import { cn } from "@/lib/utils";
import { LoadingBlock, SpButton } from "@/components/ui";
import { SpPageHero } from "@/components/sp-page-hero";
import { QualAddPanel, QualCompactCard, QualsTab } from "@/components/profile/qualifications";
import { ContactPanel, ContactsTab } from "@/components/profile/contacts";
import { INDUSTRY_OPTIONS } from "@/constants/supplier";
import "@/styles/pages/profile.css";

/* ═══ 常量（与 CompanyInfo.vue 一致）═══ */
const STATUS_TEXT: Record<string, string> = {
  PENDING: "待审核", APPROVED: "已入库", REJECTED: "不通过", RETURNED: "退回补正", DISABLED: "已停用", BLACKLIST: "黑名单",
};
const CR_FIELDS = [
  "name", "enterpriseType", "legalPerson", "registeredAddress", "businessScope",
  // ── 注册 2.0 扩展字段 ──
  "logoUrl", "organizationCode", "country", "region", "detailedAddress",
  "registeredCapital", "industry", "legalPersonPhone", "companyEmail", "companyWebsite",
] as const;
const CR_FIELD_LABELS: Record<string, string> = {
  name: "企业名称", enterpriseType: "企业类型", legalPerson: "法定代表人", registeredAddress: "注册地址", businessScope: "经营范围", tags: "业务标签",
  logoUrl: "公司logo", organizationCode: "机构代码", country: "国别", region: "所属行政区域", detailedAddress: "详细地址",
  registeredCapital: "注册资本", industry: "所属行业", legalPersonPhone: "法人联系电话", companyEmail: "公司邮箱", companyWebsite: "公司官网",
};
/** 基本资料弹窗中以多行文本呈现的字段 */
const CR_TEXTAREA_FIELDS = new Set(["registeredAddress", "businessScope", "detailedAddress"]);
/** logoUrl 走「上传后取 url」的专用控件，不走通用文本输入 */
const CR_BASIC_INPUT_FIELDS = CR_FIELDS.filter((k) => k !== "logoUrl");

type CrMode = "basic" | "quals" | "contacts" | "bank" | "perf";

/** 非 APPROVED 状态禁改提示（与后端「只有已入库供应商可以提交变更」对齐） */
function changeLockHint(st: string): string {
  if (st === "PENDING") return "入驻资料正在审核中，暂不能申请资料变更";
  if (st === "RETURNED") return "资料已退回补正，请按退回原因补充材料后重新提交审核，期间暂不能申请资料变更";
  if (st === "REJECTED") return "入驻申请未通过，暂不能申请资料变更";
  if (st === "DISABLED") return "该供应商已停用，暂不能申请资料变更";
  if (st === "BLACKLIST") return "该供应商已列入黑名单，暂不能申请资料变更";
  return "当前状态暂不能申请资料变更";
}

/* ═══ 银行账户 / 主体业绩 变更草稿（提交时 JSON.stringify 整体替换）═══ */
type BankDraft = { accountName: string; bankName: string; bankBranch: string; accountNo: string; isDefault: boolean };
type PerfDraft = { projectName: string; clientName: string; contractAmount: string; signDate: string; description: string; proofFiles: { name: string; url: string }[] };
const emptyBank = (): BankDraft => ({ accountName: "", bankName: "", bankBranch: "", accountNo: "", isDefault: false });
const emptyPerf = (): PerfDraft => ({ projectName: "", clientName: "", contractAmount: "", signDate: "", description: "", proofFiles: [] });
/** 归一化草稿行，保证 JSON 比较与提交载荷键序稳定 */
const normBank = (b: BankDraft) => ({ accountName: b.accountName.trim(), bankName: b.bankName.trim(), bankBranch: b.bankBranch.trim(), accountNo: b.accountNo.trim(), isDefault: !!b.isDefault });
const normPerf = (p: PerfDraft) => ({ projectName: p.projectName.trim(), clientName: p.clientName.trim(), contractAmount: p.contractAmount.trim(), signDate: p.signDate, description: p.description.trim(), proofFiles: p.proofFiles });

/** 企业信息（CompanyInfo.vue 移植 — 三 tab：企业信息 / 资质与证照 / 联系人 + 变更申请弹窗） */
export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"info" | "quals" | "contacts">("info");

  // ═══════════ 资质与证照 ═══════════
  const [qualifications, setQualifications] = useState<any[]>([]);
  const [qualsLoading, setQualsLoading] = useState(false);
  const [qualsErr, setQualsErr] = useState(false);
  const [qualDialogOpen, setQualDialogOpen] = useState(false);

  // ═══════════ 联系人 ═══════════
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsErr, setContactsErr] = useState(false);
  const [ctPanel, setCtPanel] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });

  // ═══════════ 变更申请弹窗 ═══════════
  const [crDlg, setCrDlg] = useState(false);
  const [crMode, setCrMode] = useState<CrMode>("basic");
  const [crSub, setCrSub] = useState(false);
  const [crForm, setCrForm] = useState<Record<string, string>>({});
  const [crOrig, setCrOrig] = useState<Record<string, string>>({});
  const [crReason, setCrReason] = useState("");
  const [crTags, setCrTags] = useState<string[]>([]);
  const [crOrigQualCount, setCrOrigQualCount] = useState(0);
  const [crOrigContactCount, setCrOrigContactCount] = useState(0);
  const crQualSnapDone = useRef(false);
  const crContactSnapDone = useRef(false);
  // ── 银行账户 / 主体业绩 聚合变更草稿（orig 为打开时的 JSON 快照，用于 dirty 比较）──
  const [crBanks, setCrBanks] = useState<BankDraft[]>([]);
  const [crBanksOrig, setCrBanksOrig] = useState("[]");
  const [crPerfs, setCrPerfs] = useState<PerfDraft[]>([]);
  const [crPerfsOrig, setCrPerfsOrig] = useState("[]");
  const [logoUploading, setLogoUploading] = useState(false);
  const [perfUploadingIdx, setPerfUploadingIdx] = useState<number | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // 最新列表快照（避免异步回调读到旧 state）
  const qualsRef = useRef<any[]>([]);
  qualsRef.current = qualifications;
  const contactsRef = useRef<any[]>([]);
  contactsRef.current = contacts;

  /* ═══════════ 初始加载 / 重试 ═══════════ */
  const fetchProfile = async () => {
    const p = await supplierApi.getProfile();
    setProfile(p);
  };
  useEffect(() => {
    (async () => {
      try { await fetchProfile(); } catch { setError(true); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const retryLoad = async () => {
    setError(false); setLoading(true);
    try { await fetchProfile(); } catch { setError(true); } finally { setLoading(false); }
  };

  const loadQualifications = async () => {
    if (qualsRef.current.length > 0) return;
    setQualsLoading(true);
    try { setQualifications(await supplierApi.listQualifications()); }
    catch { setQualsErr(true); }
    finally { setQualsLoading(false); }
  };
  const loadContacts = async () => {
    if (contactsRef.current.length > 0) return;
    setContactsLoading(true);
    try { setContacts(await supplierApi.listContacts()); }
    catch { setContactsErr(true); }
    finally { setContactsLoading(false); }
  };

  /* ═══════════ 企业信息 ═══════════ */
  const copyCreditCode = async () => {
    if (!profile?.creditCode) return;
    try { await navigator.clipboard.writeText(profile.creditCode); toast.success("已复制统一社会信用代码"); }
    catch { toast.warning("复制失败，请手动选择"); }
  };

  const profileRows = useMemo(() => {
    const p = profile;
    if (!p) return [];
    return [
      { label: "统一社会信用代码", value: p.creditCode },
      { label: "企业类型", value: p.enterpriseType },
      { label: "法定代表人", value: p.legalPerson },
      { label: "注册时间", value: dayjs(p.createdAt).format("YYYY-MM-DD") },
      // ── 注册 2.0 扩展字段 ──
      { label: "机构代码", value: p.organizationCode },
      { label: "国别", value: p.country },
      { label: "所属行政区域", value: p.region },
      { label: "注册资本", value: p.registeredCapital },
      { label: "所属行业", value: p.industry },
      { label: "法人联系电话", value: p.legalPersonPhone },
      { label: "公司邮箱", value: p.companyEmail },
      { label: "公司官网", value: p.companyWebsite },
      { label: "注册地址", value: p.registeredAddress, wide: true },
      { label: "详细地址", value: p.detailedAddress, wide: true },
      { label: "经营范围", value: p.businessScope, wide: true },
      { label: "更新时间", value: dayjs(p.updatedAt).format("YYYY-MM-DD HH:mm") },
    ];
  }, [profile]);
  const profileTags = useMemo(() => {
    const tags = profile?.tags;
    return Array.isArray(tags) && tags.length > 0 ? tags : [];
  }, [profile]);
  const bankAccounts = useMemo<any[]>(() => (Array.isArray(profile?.bankAccounts) ? profile.bankAccounts : []), [profile]);
  const performances = useMemo<any[]>(() => (Array.isArray(profile?.performances) ? profile.performances : []), [profile]);

  /* ═══════════ 资质删除 ═══════════ */
  const qHandleDelete = async (id: string) => {
    if (!window.confirm("确定要删除此资质材料吗？")) return;
    try {
      await supplierApi.deleteQualification(id);
      setQualifications(await supplierApi.listQualifications());
      toast.success("已删除");
    } catch { toast.error("删除失败"); }
  };

  /* ═══════════ 联系人删除 ═══════════ */
  const ctHandleDelete = async (id: string) => {
    if (!window.confirm("确定要删除此联系人吗？")) return;
    try {
      await supplierApi.deleteContact(id);
      setContacts(await supplierApi.listContacts());
      toast.success("已删除");
    } catch { toast.error("删除失败"); }
  };

  const onQualAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast.error("文件不能超过50MB"); return; }
    toast.warning("附件上传将在后续版本支持");
  };

  /* ═══════════ 变更申请弹窗逻辑 ═══════════ */
  const crFieldChanged = useMemo(
    () => CR_FIELDS.filter((k) => (crForm[k] ?? "") !== (crOrig[k] ?? "") && (crForm[k] ?? "").trim() !== ""),
    [crForm, crOrig],
  );
  const crHasTagsChanges = useMemo(() => {
    const filled = crTags.filter((t) => t.trim());
    const orig = (profile?.tags as string[]) || [];
    if (filled.length !== orig.length) return true;
    return filled.some((t, i) => t !== orig[i]);
  }, [crTags, profile]);
  const crHasBasicChanges = crFieldChanged.length > 0 || crHasTagsChanges;
  const crHasQualChanges = qualifications.length !== crOrigQualCount;
  const crHasContactChanges = contacts.length !== crOrigContactCount;
  const crHasBankChanges = useMemo(() => JSON.stringify(crBanks.map(normBank)) !== crBanksOrig, [crBanks, crBanksOrig]);
  const crHasPerfChanges = useMemo(() => JSON.stringify(crPerfs.map(normPerf)) !== crPerfsOrig, [crPerfs, crPerfsOrig]);
  const crHasChanges = crMode === "basic" ? crHasBasicChanges
    : crMode === "quals" ? crHasQualChanges
    : crMode === "contacts" ? crHasContactChanges
    : crMode === "bank" ? crHasBankChanges
    : crHasPerfChanges;
  /** 走审核的变更模式（基本资料 / 银行账户 / 主体业绩）均需填写变更原因 */
  const crNeedsReason = crMode === "basic" || crMode === "bank" || crMode === "perf";

  const openCrDlg = () => {
    // 禁改门控：与后端 createChangeRequest「仅 APPROVED 可提交」一致（PENDING/RETURNED 等状态 banner + toast 拦截）
    if (profile && profile.status !== "APPROVED") {
      toast.warning(changeLockHint(profile.status) || "当前状态暂不能申请资料变更");
      return;
    }
    setCrDlg(true);
    setCrMode("basic");
    const p = profile;
    if (!p) return;
    const form: Record<string, string> = {};
    const orig: Record<string, string> = {};
    CR_FIELDS.forEach((k) => { const v = (p[k] as string) ?? ""; form[k] = v; orig[k] = v; });
    setCrForm(form);
    setCrOrig(orig);
    setCrReason("");
    const ptags = p.tags;
    setCrTags(Array.isArray(ptags) && ptags.length >= 2 ? [...ptags] : ["", ""]);
    setCrOrigQualCount(qualsRef.current.length);
    setCrOrigContactCount(contactsRef.current.length);
    crQualSnapDone.current = false;
    crContactSnapDone.current = false;
    // 银行账户 / 主体业绩：以当前值初始化草稿并记录 JSON 快照（dirty 比较基准）
    const banks: BankDraft[] = (Array.isArray(p.bankAccounts) ? p.bankAccounts : []).map((b: any) => ({
      accountName: b.accountName ?? "", bankName: b.bankName ?? "", bankBranch: b.bankBranch ?? "",
      accountNo: b.accountNo ?? "", isDefault: !!b.isDefault,
    }));
    setCrBanks(banks);
    setCrBanksOrig(JSON.stringify(banks.map(normBank)));
    const perfs: PerfDraft[] = (Array.isArray(p.performances) ? p.performances : []).map((x: any) => ({
      projectName: x.projectName ?? "", clientName: x.clientName ?? "", contractAmount: x.contractAmount ?? "",
      signDate: x.signDate ? dayjs(x.signDate).format("YYYY-MM-DD") : "", description: x.description ?? "",
      proofFiles: Array.isArray(x.proofFiles) ? x.proofFiles.filter((f: any) => f?.url).map((f: any) => ({ name: f.name ?? "", url: f.url })) : [],
    }));
    setCrPerfs(perfs);
    setCrPerfsOrig(JSON.stringify(perfs.map(normPerf)));
  };

  const crReset = (k: string) => setCrForm((f) => ({ ...f, [k]: crOrig[k] }));
  const crAddTag = () => setCrTags((t) => (t.length < 8 ? [...t, ""] : t));
  const crRemoveTag = (i: number) => setCrTags((t) => (t.length > 2 ? t.filter((_, j) => j !== i) : t));

  const crSwitch = (m: CrMode) => {
    setCrMode(m);
    if (m === "quals" && !crQualSnapDone.current) {
      setQualsLoading(true);
      supplierApi.listQualifications()
        .then((list) => { setQualifications(list); setCrOrigQualCount(list.length); })
        .catch(() => {})
        .finally(() => { setQualsLoading(false); crQualSnapDone.current = true; });
    }
    if (m === "contacts" && !crContactSnapDone.current) {
      setContactsLoading(true);
      supplierApi.listContacts()
        .then((list) => { setContacts(list); setCrOrigContactCount(list.length); })
        .catch(() => {})
        .finally(() => { setContactsLoading(false); crContactSnapDone.current = true; });
    }
  };

  /* ═══ 公司logo 上传（变更弹窗内，取 url 写入 crForm.logoUrl）═══ */
  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    if (f.size > 50 * 1024 * 1024) { toast.error("文件不能超过50MB"); return; }
    setLogoUploading(true);
    try {
      const res = await uploadFile(f, "profile");
      setCrForm((form) => ({ ...form, logoUrl: res.url }));
      toast.success("logo上传成功");
    } catch { /* 失败提示已由 upload 层统一弹出 */ }
    finally { setLogoUploading(false); }
  };

  /* ═══ 银行账户草稿编辑 ═══ */
  const crBankPatch = (i: number, patch: Partial<BankDraft>) =>
    setCrBanks((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const crBankAdd = () => setCrBanks((rows) => [...rows, emptyBank()]);
  const crBankRemove = (i: number) => setCrBanks((rows) => rows.filter((_, j) => j !== i));
  const crBankSetDefault = (i: number) =>
    setCrBanks((rows) => rows.map((r, j) => ({ ...r, isDefault: j === i })));

  /* ═══ 主体业绩草稿编辑 ═══ */
  const crPerfPatch = (i: number, patch: Partial<PerfDraft>) =>
    setCrPerfs((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const crPerfAdd = () => setCrPerfs((rows) => [...rows, emptyPerf()]);
  const crPerfRemove = (i: number) => setCrPerfs((rows) => rows.filter((_, j) => j !== i));
  const crPerfRemoveFile = (i: number, fi: number) =>
    setCrPerfs((rows) => rows.map((r, j) => (j === i ? { ...r, proofFiles: r.proofFiles.filter((_, k) => k !== fi) } : r)));
  const crPerfUpload = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setPerfUploadingIdx(i);
    try {
      for (const f of files) {
        if (f.size > 50 * 1024 * 1024) { toast.error(`「${f.name}」超过50MB，已跳过`); continue; }
        try {
          const res = await uploadFile(f, "qualification");
          setCrPerfs((rows) => rows.map((r, j) => (j === i ? { ...r, proofFiles: [...r.proofFiles, { name: res.originalName || f.name, url: res.url }] } : r)));
        } catch { /* 单个文件失败不阻断其余 */ }
      }
    } finally { setPerfUploadingIdx(null); }
  };

  const crSubmit = async () => {
    if (!crHasChanges) { toast.warning("请至少修改一项资料"); return; }
    if (crMode === "bank" || crMode === "perf") {
      if (!crReason.trim()) { toast.warning("请填写变更原因"); return; }
      if (crMode === "bank") {
        const rows = crBanks.map(normBank);
        if (rows.some((b) => !b.accountName || !b.bankName || !b.accountNo)) {
          toast.warning("银行账户的户名、开户银行、账号为必填项"); return;
        }
        if (!window.confirm(`将提交「银行账户」整体变更（共 ${rows.length} 个账户），审批通过后现有账户将被本次提交替换。\n\n———\n变更原因：${crReason}`)) return;
        setCrSub(true);
        try {
          await supplierApi.createChangeRequest({ fieldName: "bankAccounts", fieldLabel: "银行账户", newValue: JSON.stringify(rows), reason: crReason.trim() });
          toast.success("已提交银行账户变更申请");
          setCrDlg(false);
        } catch { /* 错误提示已由 API 层统一弹出 */ }
        finally { setCrSub(false); }
      } else {
        const rows = crPerfs.map(normPerf);
        if (rows.some((p) => !p.projectName)) { toast.warning("业绩项目名称为必填项"); return; }
        if (rows.some((p) => p.proofFiles.length === 0)) { toast.warning("每项业绩须至少上传一份证明材料"); return; }
        if (!window.confirm(`将提交「主体业绩」整体变更（共 ${rows.length} 项业绩），审批通过后现有业绩将被本次提交替换。\n\n———\n变更原因：${crReason}`)) return;
        setCrSub(true);
        try {
          await supplierApi.createChangeRequest({ fieldName: "performances", fieldLabel: "主体业绩", newValue: JSON.stringify(rows), reason: crReason.trim() });
          toast.success("已提交主体业绩变更申请");
          setCrDlg(false);
        } catch { /* 错误提示已由 API 层统一弹出 */ }
        finally { setCrSub(false); }
      }
      return;
    }
    if (crMode === "basic") {
      if (!crReason.trim()) { toast.warning("请填写变更原因"); return; }
      const changeCount = crFieldChanged.length + (crHasTagsChanges ? 1 : 0);
      const lines = crFieldChanged.map((k) => `${CR_FIELD_LABELS[k]}\n${crOrig[k] || "（空）"} → ${crForm[k]}`);
      if (crHasTagsChanges) lines.push(`业务标签\n${crTags.filter((t) => t.trim()).join("、")}`);
      // 原 ElMessageBox HTML 摘要 → 原生 confirm 纯文本摘要（转义无需，confirm 不解析 HTML）
      if (!window.confirm(`将提交 ${changeCount} 项变更：\n\n${lines.join("\n\n")}\n\n———\n变更原因：${crReason}`)) return;
      setCrSub(true);
      let ok = 0, fail = 0;
      for (const k of crFieldChanged) {
        try {
          await supplierApi.createChangeRequest({ fieldName: k, fieldLabel: CR_FIELD_LABELS[k], oldValue: crOrig[k] || "", newValue: crForm[k], reason: crReason.trim() });
          ok++;
        } catch { fail++; }
      }
      if (crHasTagsChanges) {
        const filled = crTags.filter((t) => t.trim());
        try {
          await supplierApi.createChangeRequest({ fieldName: "tags", fieldLabel: "业务标签", oldValue: JSON.stringify(profile?.tags || []), newValue: JSON.stringify(filled), reason: crReason.trim() });
          ok++;
        } catch { fail++; }
      }
      setCrSub(false);
      if (ok > 0 && fail === 0) { toast.success(`已提交 ${ok} 项变更申请`); setCrDlg(false); }
      else if (ok > 0) { toast.warning(`部分成功：${ok} 项成功`); setCrDlg(false); }
      else { toast.error("提交失败"); }
    } else {
      toast.success("变更已生效");
      setCrDlg(false);
    }
  };

  const st = profile?.status;
  /** 非 APPROVED（含 PENDING/RETURNED）禁止发起资料变更——banner 提示 + 按钮禁用 + openCrDlg toast 兜底 */
  const changeLocked = !!st && st !== "APPROVED";

  return (
    <>
      <SpPageHero
        icon={Building2}
        title="企业信息"
        sub="基本信息、联系人、银行账户、资质与主体业绩管理。"
        actions={<SpButton variant="primary" icon={PenLine} onClick={openCrDlg} disabled={changeLocked}>申请资料变更</SpButton>}
      />

      {/* ═══ 禁改 banner（PENDING/RETURNED 等状态沿用 reason-card 警示样式）═══ */}
      {changeLocked && (
        <div className="reason-card warning profile-lock-banner">
          <strong>{STATUS_TEXT[st] || st}</strong>
          {changeLockHint(st)}
        </div>
      )}

      {/* ═══ Tab bar ═══ */}
      <div className="neu-tab-bar profile-tabs">
        <button type="button" className={cn("neu-tab", activeTab === "info" && "active", activeTab === "info" && "is-active")} onClick={() => setActiveTab("info")}>基本信息</button>
        <button type="button" className={cn("neu-tab", activeTab === "quals" && "active", activeTab === "quals" && "is-active")} onClick={() => { setActiveTab("quals"); void loadQualifications(); }}>资质信息</button>
        <button type="button" className={cn("neu-tab", activeTab === "contacts" && "active", activeTab === "contacts" && "is-active")} onClick={() => { setActiveTab("contacts"); void loadContacts(); }}>联系人信息</button>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        /* ═══ Error ═══ */
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={() => void retryLoad()}>重新加载</SpButton>
        </div>
      ) : profile ? (
        <>
          {/* ══════════ 企业信息 Tab ══════════ */}
          {activeTab === "info" && (
            <>
            <div className="detail-card">
              <div className="company-identity">
                {profile.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.logoUrl} alt="公司logo" className="company-avatar company-avatar-img" />
                ) : (
                  <div className="company-avatar company-avatar-fallback" title="暂未上传公司logo">{profile.name?.charAt(0)}</div>
                )}
                <div className="company-title">
                  <h2>{profile.name}</h2>
                  <div className="company-subline">
                    <span className="company-credit-code">{profile.creditCode}</span>
                    <button
                      type="button"
                      onClick={() => void copyCreditCode()}
                      title="复制信用代码"
                      style={{ padding: 0, fontSize: 18, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "inline-flex" }}
                    >
                      <Copy size={18} />
                    </button>
                    <span className={cn("sp-status", st === "PENDING" && "pending", st === "APPROVED" && "approved", (st === "REJECTED" || st === "BLACKLIST") && "rejected", st === "RETURNED" && "returned", st === "DISABLED" && "disabled")}>
                      {STATUS_TEXT[st] || st}
                    </span>
                  </div>
                </div>
              </div>
              <div className="info-grid">
                {profileRows.map((row) => (
                  <div key={row.label} className={cn("info-item", row.wide && "wide")}>
                    <span>{row.label}</span>
                    {row.label === "公司官网" && row.value ? (
                      <a className="info-item-link" href={/^https?:\/\//.test(row.value) ? row.value : `https://${row.value}`} target="_blank" rel="noopener noreferrer">{row.value}</a>
                    ) : (
                      <strong>{row.value || "—"}</strong>
                    )}
                  </div>
                ))}
              </div>
              <div className="info-tags">
                <span className="info-tags-label">业务标签</span>
                {profileTags.length > 0 ? (
                  <div className="info-tags-list">
                    {profileTags.map((t: string) => <span key={t} className="info-tag-chip">{t}</span>)}
                  </div>
                ) : (
                  <span className="info-tags-empty">暂无业务标签，可点「申请资料变更」补充</span>
                )}
              </div>
              {profile.rejectReason && (
                <div className="reason-card error"><strong>审核不通过原因</strong>{profile.rejectReason}</div>
              )}
              {profile.returnReason && (
                <div className="reason-card warning"><strong>退回补正原因</strong>{profile.returnReason}</div>
              )}
            </div>

            {/* ═══ 银行账户（注册 2.0）═══ */}
            <div className="detail-card prof-block">
              <div className="prof-block-head">
                <span className="prof-block-icon"><Landmark size={16} strokeWidth={1.75} /></span>
                <h3 className="prof-block-title">银行账户</h3>
                <span className="prof-block-count">{bankAccounts.length} 个账户</span>
              </div>
              {bankAccounts.length > 0 ? (
                <div className="neu-table-card">
                  <table className="neu-table">
                    <thead>
                      <tr>
                        <th>户名</th>
                        <th>开户银行</th>
                        <th>支行</th>
                        <th>账号</th>
                        <th style={{ width: 90 }}>默认</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.map((b: any) => (
                        <tr key={b.id}>
                          <td>{b.accountName || "—"}</td>
                          <td>{b.bankName || "—"}</td>
                          <td>{b.bankBranch || "—"}</td>
                          <td className="prof-mono">{b.accountNo || "—"}</td>
                          <td>
                            {b.isDefault
                              ? <span className="prof-default-tag"><Star size={11} />默认</span>
                              : <span className="prof-muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="prof-empty"><Landmark size={20} strokeWidth={1.5} /><p>暂无银行账户</p></div>
              )}
            </div>

            {/* ═══ 主体业绩（注册 2.0）═══ */}
            <div className="detail-card prof-block">
              <div className="prof-block-head">
                <span className="prof-block-icon"><Briefcase size={16} strokeWidth={1.75} /></span>
                <h3 className="prof-block-title">主体业绩</h3>
                <span className="prof-block-count">{performances.length} 项业绩</span>
              </div>
              {performances.length > 0 ? (
                <div className="perf-grid">
                  {performances.map((p: any) => (
                    <article key={p.id} className="perf-card">
                      <div className="perf-card-head">
                        <h4 className="perf-name">{p.projectName || "—"}</h4>
                        {p.contractAmount && <span className="perf-amount">{p.contractAmount}</span>}
                      </div>
                      <div className="perf-meta">
                        <span className="perf-meta-item"><span className="perf-meta-l">客户</span>{p.clientName || "—"}</span>
                        <span className="perf-meta-item"><span className="perf-meta-l">签订日期</span>{p.signDate ? dayjs(p.signDate).format("YYYY-MM-DD") : "—"}</span>
                      </div>
                      {p.description && <p className="perf-desc">{p.description}</p>}
                      <div className="perf-files">
                        <span className="perf-files-l">证明材料</span>
                        {Array.isArray(p.proofFiles) && p.proofFiles.length > 0 ? (
                          p.proofFiles.map((f: any, i: number) => (
                            f?.url ? (
                              <a key={`pf-${i}`} className="perf-file-link" href={f.url} target="_blank" rel="noopener noreferrer">
                                <Paperclip size={13} />
                                <span>{f.name || `附件${i + 1}`}</span>
                              </a>
                            ) : null
                          ))
                        ) : (
                          <span className="prof-muted">暂无</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="prof-empty"><Briefcase size={20} strokeWidth={1.5} /><p>暂无主体业绩</p></div>
              )}
            </div>
          </>
          )}

          {/* ══════════ 资质与证照 Tab ══════════ */}
          {activeTab === "quals" && (
            <div>
              {qualsLoading ? <LoadingBlock /> : qualsErr ? (
                <div className="sp-error-block">
                  <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
                  <div className="sp-error-text">资质数据加载失败</div>
                  <SpButton variant="primary" onClick={() => void loadQualifications()}>重新加载</SpButton>
                </div>
              ) : (
                <QualsTab qualifications={qualifications} onDelete={(id) => void qHandleDelete(id)} />
              )}
            </div>
          )}

          {/* ══════════ 联系人 Tab ══════════ */}
          {activeTab === "contacts" && (
            <div>
              {contactsLoading ? <LoadingBlock /> : contactsErr ? (
                <div className="sp-error-block">
                  <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
                  <div className="sp-error-text">联系人数据加载失败</div>
                  <SpButton variant="primary" onClick={() => void loadContacts()}>重新加载</SpButton>
                </div>
              ) : (
                <ContactsTab
                  contacts={contacts}
                  onAdd={() => setCtPanel({ open: true, editing: null })}
                  onEdit={(c) => setCtPanel({ open: true, editing: c })}
                  onDelete={(id) => void ctHandleDelete(id)}
                />
              )}
            </div>
          )}
        </>
      ) : null}

      {/* ═══ 资质弹窗（挂载即重置）═══ */}
      {qualDialogOpen && (
        <QualAddPanel
          onAdded={async () => {
            setQualDialogOpen(false);
            try { setQualifications(await supplierApi.listQualifications()); } catch { /* 全局已提示 */ }
          }}
          onClose={() => setQualDialogOpen(false)}
        />
      )}

      {/* ═══ 联系人弹窗 ═══ */}
      {ctPanel.open && (
        <ContactPanel
          editing={ctPanel.editing}
          onSaved={async () => {
            setCtPanel((p) => ({ ...p, open: false }));
            try { setContacts(await supplierApi.listContacts()); } catch { /* 全局已提示 */ }
          }}
          onClose={() => setCtPanel((p) => ({ ...p, open: false }))}
        />
      )}

      {/* ═══ 变更申请弹窗（crp — Teleport 等价）═══ */}
      {crDlg && createPortal(
        <div className="crp-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCrDlg(false); }}>
          <div className="crp-panel">
            <div className="crp-head">
              <div className="crp-head-l">
                <div className="crp-head-i"><PenLine size={20} /></div>
                <div>
                  <h2 className="crp-title">申请资料变更</h2>
                  <p className="crp-sub">选择变更类别，编辑对应内容后提交</p>
                </div>
              </div>
              <button type="button" className="crp-x" onClick={() => setCrDlg(false)}><X size={18} /></button>
            </div>
            <div className="crp-body">
              <div className="crp-bar">
                <button type="button" className={cn("neu-tab", crMode === "basic" && "active", crMode === "basic" && "is-active")} onClick={() => crSwitch("basic")}>基本资料</button>
                <button type="button" className={cn("neu-tab", crMode === "bank" && "active", crMode === "bank" && "is-active")} onClick={() => crSwitch("bank")}>银行账户</button>
                <button type="button" className={cn("neu-tab", crMode === "perf" && "active", crMode === "perf" && "is-active")} onClick={() => crSwitch("perf")}>主体业绩</button>
                <button type="button" className={cn("neu-tab", crMode === "quals" && "active", crMode === "quals" && "is-active")} onClick={() => crSwitch("quals")}>资质信息</button>
                <button type="button" className={cn("neu-tab", crMode === "contacts" && "active", crMode === "contacts" && "is-active")} onClick={() => crSwitch("contacts")}>联系人信息</button>
              </div>

              {crMode === "basic" && (
                <div>
                  {crHasChanges && (
                    <div className="crp-cnt">
                      <span className="crp-cnt-n">{crFieldChanged.length + (crHasTagsChanges ? 1 : 0)}</span>
                      <span>项修改</span>
                    </div>
                  )}
                  <div className="crp-fs">
                    {CR_BASIC_INPUT_FIELDS.map((k) => (
                      <div key={k} className={cn("crp-f", crForm[k] !== crOrig[k] && "dirty")}>
                        <div className="crp-fh">
                          <label>{CR_FIELD_LABELS[k]}</label>
                          {crForm[k] !== crOrig[k] && <span className="crp-tag">已修改</span>}
                        </div>
                        {crForm[k] !== crOrig[k] && crOrig[k] && (
                          <div className="crp-ov">
                            <span className="crp-ovl">原值</span>
                            <span className="crp-ovv">{crOrig[k]}</span>
                            <button type="button" className="neu-btn-xs" onClick={() => crReset(k)}>还原</button>
                          </div>
                        )}
                        {CR_TEXTAREA_FIELDS.has(k) ? (
                          <textarea
                            className="neu-input"
                            rows={k === "businessScope" ? 3 : 2}
                            value={crForm[k]}
                            onChange={(e) => setCrForm((f) => ({ ...f, [k]: e.target.value }))}
                          />
                        ) : (
                          <>
                            <input
                              className="neu-input"
                              list={k === "industry" ? "crp-industry-list" : undefined}
                              value={crForm[k]}
                              onChange={(e) => setCrForm((f) => ({ ...f, [k]: e.target.value }))}
                            />
                            {k === "industry" && (
                              <datalist id="crp-industry-list">
                                {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o} />)}
                              </datalist>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    {/* 公司logo — 上传后以 url 作为变更值 */}
                    <div className={cn("crp-f", (crForm.logoUrl ?? "") !== (crOrig.logoUrl ?? "") && "dirty")}>
                      <div className="crp-fh">
                        <label>{CR_FIELD_LABELS.logoUrl}</label>
                        {(crForm.logoUrl ?? "") !== (crOrig.logoUrl ?? "") && <span className="crp-tag">已修改</span>}
                      </div>
                      {(crForm.logoUrl ?? "") !== (crOrig.logoUrl ?? "") && crOrig.logoUrl && (
                        <div className="crp-ov">
                          <span className="crp-ovl">原值</span>
                          <span className="crp-ovv">{crOrig.logoUrl}</span>
                          <button type="button" className="neu-btn-xs" onClick={() => crReset("logoUrl")}>还原</button>
                        </div>
                      )}
                      <div className="crp-logo-row">
                        {crForm.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crForm.logoUrl} alt="logo预览" className="crp-logo-preview" />
                        ) : (
                          <div className="crp-logo-preview crp-logo-empty"><ImageUp size={18} strokeWidth={1.5} /><span>未上传</span></div>
                        )}
                        <input
                          ref={logoInputRef}
                          type="file"
                          className="sp-file-hidden"
                          accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
                          onChange={(e) => void onLogoFile(e)}
                        />
                        <button type="button" className="neu-btn-xs" disabled={logoUploading} onClick={() => logoInputRef.current?.click()}>
                          {logoUploading ? "上传中…" : crForm.logoUrl ? "替换图片" : "上传图片"}
                        </button>
                        {crForm.logoUrl && (
                          <button type="button" className="neu-btn-xs is-danger" onClick={() => setCrForm((f) => ({ ...f, logoUrl: "" }))}>移除</button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* 业务标签 */}
                  <div className="crp-f" style={{ marginBottom: 17 }}>
                    <div className="crp-fh">
                      <label>业务标签</label>
                      <span className="crp-n">{crTags.filter((t) => t.trim()).length}/8</span>
                      <button type="button" className="neu-btn-xs" disabled={crTags.length >= 8} onClick={crAddTag} style={{ marginLeft: "auto" }}>+ 添加</button>
                    </div>
                    {crTags.map((t, i) => (
                      <div key={"crtag" + i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <span className="crp-fh" style={{ minWidth: 24, fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>{i + 1}.</span>
                        <input
                          className={cn("neu-input", t.trim() && (!(profile?.tags?.[i]) || t !== profile.tags[i]) && "dirty")}
                          value={t}
                          onChange={(e) => { const next = [...crTags]; next[i] = e.target.value; setCrTags(next); }}
                          placeholder={i === 0 ? "如：办公用品" : i === 1 ? "如：钻机销售" : "标签" + (i + 1)}
                          maxLength={20}
                          style={{ flex: 1 }}
                        />
                        {crTags.length > 2 && <button type="button" className="neu-btn-xs is-danger" onClick={() => crRemoveTag(i)}>删除</button>}
                      </div>
                    ))}
                  </div>
                  <div className="crp-f">
                    <label>变更原因</label>
                    <span className="crp-n">{crReason.length}/200</span>
                    <textarea
                      className="neu-input" rows={3} maxLength={200}
                      placeholder="请说明本次变更的原因"
                      value={crReason}
                      onChange={(e) => setCrReason(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* ═══ 银行账户（聚合变更：整体替换，一条变更记录）═══ */}
              {crMode === "bank" && (
                <div>
                  {crHasBankChanges && (
                    <div className="crp-cnt">
                      <span className="crp-cnt-n">{crBanks.length}</span>
                      <span>个账户将提交（审批通过后替换现有 {bankAccounts.length} 个账户）</span>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <SpButton variant="soft" icon={Plus} onClick={crBankAdd}>添加银行账户</SpButton>
                  </div>
                  <div className="crp-rows">
                    {crBanks.length === 0 && (
                      <div className="qc-e">
                        <div className="sp-empty-icon"><Landmark size={22} strokeWidth={1.75} /></div>
                        <p>暂无银行账户</p>
                      </div>
                    )}
                    {crBanks.map((b, i) => (
                      <div key={"crbank" + i} className="crp-row-card">
                        <div className="crp-row-head">
                          <span className="crp-row-idx">账户 {i + 1}</span>
                          <button
                            type="button"
                            className={cn("neu-btn-xs", b.isDefault && "is-success")}
                            onClick={() => crBankSetDefault(i)}
                          >
                            <Star size={12} />{b.isDefault ? "默认账户" : "设为默认"}
                          </button>
                          <button type="button" className="neu-btn-xs is-danger" onClick={() => crBankRemove(i)}>
                            <Trash2 size={12} />删除
                          </button>
                        </div>
                        <div className="crp-row-grid">
                          <div className="crp-cell">
                            <label>户名 <i>*</i></label>
                            <input className="neu-input" value={b.accountName} onChange={(e) => crBankPatch(i, { accountName: e.target.value })} placeholder="户名" />
                          </div>
                          <div className="crp-cell">
                            <label>开户银行 <i>*</i></label>
                            <input className="neu-input" value={b.bankName} onChange={(e) => crBankPatch(i, { bankName: e.target.value })} placeholder="如：中国工商银行" />
                          </div>
                          <div className="crp-cell">
                            <label>支行</label>
                            <input className="neu-input" value={b.bankBranch} onChange={(e) => crBankPatch(i, { bankBranch: e.target.value })} placeholder="开户支行（选填）" />
                          </div>
                          <div className="crp-cell">
                            <label>账号 <i>*</i></label>
                            <input className="neu-input" value={b.accountNo} onChange={(e) => crBankPatch(i, { accountNo: e.target.value })} placeholder="银行账号" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="crp-f" style={{ marginTop: 4 }}>
                    <label>变更原因</label>
                    <span className="crp-n">{crReason.length}/200</span>
                    <textarea
                      className="neu-input" rows={3} maxLength={200}
                      placeholder="请说明本次变更的原因"
                      value={crReason}
                      onChange={(e) => setCrReason(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* ═══ 主体业绩（聚合变更：整体替换，一条变更记录）═══ */}
              {crMode === "perf" && (
                <div>
                  {crHasPerfChanges && (
                    <div className="crp-cnt">
                      <span className="crp-cnt-n">{crPerfs.length}</span>
                      <span>项业绩将提交（审批通过后替换现有 {performances.length} 项业绩）</span>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <SpButton variant="soft" icon={Plus} onClick={crPerfAdd}>添加业绩</SpButton>
                  </div>
                  <div className="crp-rows">
                    {crPerfs.length === 0 && (
                      <div className="qc-e">
                        <div className="sp-empty-icon"><Briefcase size={22} strokeWidth={1.75} /></div>
                        <p>暂无主体业绩</p>
                      </div>
                    )}
                    {crPerfs.map((p, i) => (
                      <div key={"crperf" + i} className="crp-row-card">
                        <div className="crp-row-head">
                          <span className="crp-row-idx">业绩 {i + 1}</span>
                          <button type="button" className="neu-btn-xs is-danger" onClick={() => crPerfRemove(i)}>
                            <Trash2 size={12} />删除
                          </button>
                        </div>
                        <div className="crp-row-grid">
                          <div className="crp-cell">
                            <label>项目名称 <i>*</i></label>
                            <input className="neu-input" value={p.projectName} onChange={(e) => crPerfPatch(i, { projectName: e.target.value })} placeholder="业绩项目名称" />
                          </div>
                          <div className="crp-cell">
                            <label>客户</label>
                            <input className="neu-input" value={p.clientName} onChange={(e) => crPerfPatch(i, { clientName: e.target.value })} placeholder="业主/客户名称（选填）" />
                          </div>
                          <div className="crp-cell">
                            <label>合同金额</label>
                            <input className="neu-input" value={p.contractAmount} onChange={(e) => crPerfPatch(i, { contractAmount: e.target.value })} placeholder="如：500万元（选填）" />
                          </div>
                          <div className="crp-cell">
                            <label>签订日期</label>
                            <input className="neu-input" type="date" value={p.signDate} onChange={(e) => crPerfPatch(i, { signDate: e.target.value })} />
                          </div>
                          <div className="crp-cell crp-cell-wide">
                            <label>业绩描述</label>
                            <textarea className="neu-input" rows={2} value={p.description} onChange={(e) => crPerfPatch(i, { description: e.target.value })} placeholder="业绩简要描述（选填）" />
                          </div>
                        </div>
                        <div className="crp-cell crp-cell-wide">
                          <label>证明材料 <i>*</i></label>
                          <div className="crp-files">
                            {p.proofFiles.map((f, fi) => (
                              <span key={"crpf" + fi} className="crp-file-chip">
                                <Paperclip size={12} />
                                <span className="crp-file-name">{f.name || `附件${fi + 1}`}</span>
                                <button type="button" className="crp-file-x" onClick={() => crPerfRemoveFile(i, fi)} title="移除">
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            <label className="neu-btn-xs crp-file-add">
                              <input
                                type="file"
                                hidden
                                multiple
                                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"
                                onChange={(e) => void crPerfUpload(i, e)}
                              />
                              {perfUploadingIdx === i ? "上传中…" : "+ 上传证明"}
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="crp-f" style={{ marginTop: 4 }}>
                    <label>变更原因</label>
                    <span className="crp-n">{crReason.length}/200</span>
                    <textarea
                      className="neu-input" rows={3} maxLength={200}
                      placeholder="请说明本次变更的原因"
                      value={crReason}
                      onChange={(e) => setCrReason(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {crMode === "quals" && (
                <div>
                  {qualsLoading ? <LoadingBlock /> : (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <SpButton variant="primary" icon={Plus} onClick={() => setQualDialogOpen(true)}>添加资质</SpButton>
                      </div>
                      {qualifications.length > 0 ? (
                        <div className="qual-grid-sm">
                          {qualifications.map((q) => (
                            <QualCompactCard key={q.id} q={q} onDelete={(id) => void qHandleDelete(id)} onQualAttach={onQualAttach} />
                          ))}
                        </div>
                      ) : (
                        <div className="qc-e">
                          <div className="sp-empty-icon"><Folder size={22} strokeWidth={1.75} /></div>
                          <p>暂无资质材料</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {crMode === "contacts" && (
                <div>
                  {contactsLoading ? <LoadingBlock /> : (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <SpButton variant="primary" icon={Plus} onClick={() => setCtPanel({ open: true, editing: null })}>添加联系人</SpButton>
                      </div>
                      {contacts.length > 0 ? (
                        <div className="neu-table-card">
                          <table className="neu-table">
                            <thead>
                              <tr>
                                <th style={{ width: 120 }}>姓名</th>
                                <th style={{ width: 140 }}>手机号</th>
                                <th>邮箱</th>
                                <th style={{ width: 100 }}>职位</th>
                                <th style={{ width: 120 }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {contacts.map((row) => (
                                <tr key={row.id}>
                                  <td>
                                    <div className="crcell">
                                      <span className="crav">{row.name?.charAt(0)}</span>
                                      <span className="crnm">{row.name}</span>
                                    </div>
                                  </td>
                                  <td>{row.phone}</td>
                                  <td>{row.email || "-"}</td>
                                  <td>{row.position || "-"}</td>
                                  <td>
                                    <button type="button" className="neu-btn-xs" onClick={() => setCtPanel({ open: true, editing: row })}>编辑</button>
                                    <button type="button" className="neu-btn-xs is-danger" onClick={() => void ctHandleDelete(row.id)}>删除</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="qc-e">
                          <div className="sp-empty-icon"><Phone size={22} strokeWidth={1.75} /></div>
                          <p>暂无联系人</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="crp-ft">
              {!crHasChanges ? (
                <span className="crp-ft-h">修改内容后即可提交</span>
              ) : crNeedsReason && !crReason.trim() ? (
                <span className="crp-ft-h ok">请填写变更原因</span>
              ) : crMode === "basic" ? (
                <span className="crp-ft-h ok">已修改 {crFieldChanged.length + (crHasTagsChanges ? 1 : 0)} 项</span>
              ) : crMode === "bank" || crMode === "perf" ? (
                <span className="crp-ft-h ok">检测到变更 · 将提交一条整体替换记录</span>
              ) : (
                <span className="crp-ft-h ok">检测到变更</span>
              )}
              {(crMode === "quals" || crMode === "contacts") && (
                <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, marginLeft: "auto" }}>⚠ 资质与联系人修改保存后立即生效（不走审核）</span>
              )}
              <div className="neu-btn-group">
                <button type="button" className="neu-btn-soft" onClick={() => setCrDlg(false)}>取消</button>
                <button
                  type="button"
                  className="neu-btn-primary"
                  disabled={!crHasChanges || (crNeedsReason && !crReason.trim()) || crSub}
                  onClick={() => void crSubmit()}
                >
                  {crSub ? "提交中…" : "申请变更"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
