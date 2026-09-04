"use client";

/**
 * 供应商正式注册五步向导：
 * 1 身份与账号  2 企业与业务  3 联系人  4 资质与履历  5 确认提交
 *
 * 暂存/恢复：useAutoSave('register') 草稿存于本机 localStorage——
 * 恢复只读取当前浏览器自己的草稿，天然不会恢复他机/他人填写内容。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Download, ImagePlus, Info, KeyRound, Mail, Paperclip, Plus, ShieldCheck, Tags, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/api/auth";
import { uploadRegistrationFile, type RegistrationUploadCredentials } from "@/lib/api/upload";
import { useAutoSave } from "@/hooks/use-auto-save";
import { getErrorMessage, getRegistrationDraftKey } from "@/lib/registration-validation";
import { replaceObjectUrlPreview, revokeObjectUrlPreview } from "@/lib/object-url-preview";
import { RegisterAgreement } from "@/components/register-agreement";
import { BusinessTagField } from "@/components/registration/business-tag-field";
import { PasswordField } from "@/components/registration/password-field";
import { RegistrationField, RegistrationSection, RegistrationShell, type RegistrationStep } from "@/components/registration/registration-shell";
import { SpSwitch } from "@/components/ui";
import { ENTERPRISE_TYPES, INDUSTRY_OPTIONS } from "@/constants/supplier";
import "@/styles/pages/register2.css";

interface ContactRow { name: string; gender: string; phone: string; idCard: string; email: string; position: string; isPrimary: boolean }
interface BankRow { accountName: string; bankName: string; bankBranch: string; accountNo: string; isDefault: boolean }
interface QualRow { type: string; name: string; fileUrl: string; attachments: { name: string; url: string }[]; validFrom: string; validTo: string }
interface PerfRow { projectName: string; clientName: string; contractAmount: string; signDate: string; description: string; proofFiles: { name: string; url: string }[] }
interface FileAsset { url: string; originalName: string }

const STEPS = [
  { label: "身份与账号", description: "验证登录身份" },
  { label: "企业与业务", description: "登记主体与业务方向" },
  { label: "联系人", description: "维护业务联系人" },
  { label: "资质与履历", description: "补充账户、证照与业绩" },
  { label: "确认提交", description: "核对资料并提交审核" },
] satisfies RegistrationStep[];
const QUAL_TYPES = ["营业执照", "资质证书", "安全生产许可证", "质量管理体系认证", "环境管理体系认证", "其他"];

/* ─── 多文件上传（附加材料 / 业绩证明）─── */
function MultiFiles({ value, onChange, label = "上传附件", credentials }: {
  value: { name: string; url: string }[];
  onChange: (v: { name: string; url: string }[]) => void;
  label?: string;
  credentials: RegistrationUploadCredentials;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.warning("注册附件不能超过10MB"); return; }
    setBusy(true);
    try {
      const asset: FileAsset = await uploadRegistrationFile(file, "qualification", credentials);
      onChange([...value, { name: asset.originalName || file.name, url: asset.url }]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "上传失败，请重试"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reg-files">
      {value.map((f, i) => (
        <span key={`${f.url}-${i}`} className="reg-file-chip">
          <Paperclip size={11} />
          <span>{f.name}</span>
          <button type="button" className="reg-file-x" aria-label="移除附件" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <button type="button" className="reg-add-file" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Plus size={11} />
        {busy ? "上传中…" : label}
      </button>
      <input ref={inputRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={pick} />
    </div>
  );
}

/* ─── 单文件上传按钮（资质主文件）─── */
function SingleFile({ url, onPicked, credentials }: {
  url: string;
  onPicked: (a: FileAsset | null) => void;
  credentials: RegistrationUploadCredentials;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.warning("注册附件不能超过10MB"); return; }
    setBusy(true);
    try {
      onPicked(await uploadRegistrationFile(file, "qualification", credentials));
    } catch (error: unknown) {
      onPicked(null);
      toast.error(getErrorMessage(error, "上传失败，请重试"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="reg-btn reg-btn--file" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Upload size={13} />
        {busy ? "上传中…" : url ? "已上传 · 重新上传" : "上传文件"}
      </button>
      <input ref={inputRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={pick} />
    </>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");

  /* ── 第 1 部分：账号 + 基本信息 ── */
  // 用户名固定取「机构代码」、联系人/邮箱在第二步维护，故此处仅保留密码
  const [account, setAccount] = useState({ password: "", confirmPassword: "" });
  const [basic, setBasic] = useState({
    logoUrl: "", name: "", creditCode: "", country: "中国", region: "",
    detailedAddress: "", registeredAddress: "", registeredCapital: "", enterpriseType: "", industry: "",
    businessScope: "", legalPerson: "", legalPersonIdCard: "", legalPersonPhone: "", companyEmail: "", companyWebsite: "",
  });
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const logoPreviewUrlRef = useRef("");
  // 业务标签：以标签库选择为主（自创标签提交后进入待审核，审核通过入池）
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([]);
  // 注册手机验证码（后端必填）
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [registrationCode, setRegistrationCode] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);

  /* ── 第 2-5 部分 ── */
  const [contacts, setContacts] = useState<ContactRow[]>([{ name: "", gender: "", phone: "", idCard: "", email: "", position: "", isPrimary: true }]);
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [quals, setQuals] = useState<QualRow[]>([{ type: "营业执照", name: "", fileUrl: "", attachments: [], validFrom: "", validTo: "" }]);
  const [perfs, setPerfs] = useState<PerfRow[]>([]);

  const [agree, setAgree] = useState(false);
  const [creditCodeDuplicate, setCreditCodeDuplicate] = useState(false);
  const [legalIdCardDuplicate, setLegalIdCardDuplicate] = useState(false);

  /* ── 本机草稿暂存（localStorage 仅本浏览器可读，恢复不会拿到他人内容）── */
  const draftData = useMemo(() => ({
    step,
    registrationPhone,
    basic, tags, contacts, banks, quals, perfs,
  }), [step, registrationPhone, basic, tags, contacts, banks, quals, perfs]);
  const recoverableDraftKey = getRegistrationDraftKey(user?.id);
  const draft = useAutoSave(recoverableDraftKey ?? "register:disabled", draftData, {
    enabled: Boolean(recoverableDraftKey),
  });
  const draftTimeLabel = draft.storedAt ? dayjs(draft.storedAt).format("MM月DD日 HH:mm") : "";
  const [showRecovery, setShowRecovery] = useState(false);
  const { restoreDraft } = draft;
  const restoreRegistrationDraft = useCallback(
    () => restoreDraft() as Partial<typeof draftData> | null,
    [restoreDraft],
  );
  useEffect(() => {
    if (user?.id) return;
    try {
      localStorage.removeItem("supplier_draft:register:anonymous");
    } catch {
      // 隐私清理不应阻塞注册流程。
    }
  }, [user?.id]);
  useEffect(() => () => {
    revokeObjectUrlPreview(logoPreviewUrlRef.current);
    logoPreviewUrlRef.current = "";
  }, []);
  useEffect(() => {
    if (!recoverableDraftKey) return;
    const timer = window.setTimeout(() => {
      const recovered = restoreRegistrationDraft();
      if (recovered && (recovered.basic?.name || recovered.basic?.creditCode)) {
        setShowRecovery(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [recoverableDraftKey, restoreRegistrationDraft]);

  function acceptRecovery() {
    const d = restoreRegistrationDraft();
    if (!d) return;
    setBasic((b) => ({ ...b, ...d.basic }));
    setTags(Array.isArray(d.tags) ? d.tags.filter(Boolean) : []);
    if (d.registrationPhone) setRegistrationPhone(d.registrationPhone);
    setContacts(d.contacts?.length ? d.contacts.map((c: ContactRow) => ({ ...c })) : contacts);
    setBanks(d.banks?.length ? d.banks.map((b: BankRow) => ({ ...b })) : []);
    setQuals(d.quals?.length ? d.quals.map((q: QualRow) => ({ ...q, attachments: q.attachments ?? [] })) : quals);
    setPerfs(d.perfs?.length ? d.perfs.map((p: PerfRow) => ({ ...p, proofFiles: p.proofFiles ?? [] })) : []);
    const recoveredStep = Math.min(Number(d.step) || 0, STEPS.length - 1);
    setStep(recoveredStep);
    setMaxVisitedStep(recoveredStep);
    draft.markClean();
    setShowRecovery(false);
    toast.success("已恢复本机草稿（密码需重新输入）");
  }
  function discardRecovery() { draft.clearDraft(); setShowRecovery(false); }

  /* ── 标签库（公开接口，注册页可用）── */
  useEffect(() => {
    authApi.listBusinessTags().then(setTagOptions).catch(() => setTagOptions([]));
  }, []);
  const inTagPool = useCallback((t: string) => tagOptions.some((o) => o.name === t), [tagOptions]);

  /* ── 注册短信验证码 ── */
  async function sendRegCode() {
    if (!/^1[3-9]\d{9}$/.test(registrationPhone.trim())) { toast.warning("请先输入有效的注册手机号"); return; }
    setCodeSending(true);
    try {
      await authApi.sendRegistrationCode(registrationPhone.trim());
      toast.success("验证码已发送");
      setCodeCooldown(60);
      const timer = setInterval(() => {
        setCodeCooldown((c) => { if (c <= 1) { clearInterval(timer); return 0; } return c - 1; });
      }, 1000);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "验证码发送失败，请稍后重试"));
    } finally {
      setCodeSending(false);
    }
  }

  /* ── 查重 ── */
  async function checkCreditCode() {
    setCreditCodeDuplicate(false);
    const code = basic.creditCode.trim();
    if (!/^[0-9A-Z]{18}$/.test(code)) return;
    try {
      const res = await authApi.checkDuplicate({ creditCode: code });
      setCreditCodeDuplicate(res.creditCode);
      if (res.creditCode) toast.warning("该统一社会信用代码已被注册，请核对后重试");
    } catch { /* 查重失败不阻塞 */ }
  }
  async function checkLegalIdCard() {
    setLegalIdCardDuplicate(false);
    const id = basic.legalPersonIdCard.trim();
    if (!/^\d{17}[\dXx]$/.test(id)) return;
    try {
      const res = await authApi.checkDuplicate({ legalPersonIdCard: id });
      setLegalIdCardDuplicate(res.legalPersonIdCard);
      if (res.legalPersonIdCard) toast.warning("该法定代表人身份证号已用于其他供应商注册，请核对");
    } catch { /* 不阻塞 */ }
  }

  /* ── 分步校验 ── */
  function focusFirstError() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        ".reg-step-pane:not([hidden]) [aria-invalid='true'], .reg-step-pane:not([hidden]) .is-err",
      )?.focus();
    });
  }

  function validate(targetStep = step): boolean {
    const e: Record<string, string> = {};
    if (targetStep === 0) {
      if (!account.password) e.password = "请输入密码";
      else if (account.password.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)/.test(account.password)) e.password = "密码须≥8位且同时包含字母和数字";
      if (account.confirmPassword !== account.password) e.confirmPassword = "两次输入的密码不一致";
      if (!registrationPhone.trim()) e.registrationPhone = "请输入注册手机号";
      else if (!/^1[3-9]\d{9}$/.test(registrationPhone.trim())) e.registrationPhone = "注册手机号格式不正确";
      if (!registrationCode.trim()) e.registrationCode = "请输入短信验证码";
      else if (!/^\d{6}$/.test(registrationCode.trim())) e.registrationCode = "请输入 6 位短信验证码";
    }
    if (targetStep === 1) {
      if (!basic.name.trim()) e.name = "请输入企业名称";
      if (!basic.creditCode.trim()) e.creditCode = "请输入统一社会信用代码";
      else if (!/^[0-9A-Z]{18}$/.test(basic.creditCode.trim())) e.creditCode = "请输入18位统一社会信用代码";
      if (!basic.enterpriseType) e.enterpriseType = "请选择公司体制类型";
      if (!basic.registeredAddress.trim()) e.registeredAddress = "请输入注册地址";
      if (!basic.businessScope.trim()) e.businessScope = "请输入经营范围";
      if (!basic.legalPerson.trim()) e.legalPerson = "请输入法定代表人姓名";
      if (!basic.legalPersonIdCard.trim()) e.legalPersonIdCard = "请输入法定代表人身份证号";
      else if (!/^\d{17}[\dXx]$/.test(basic.legalPersonIdCard.trim())) e.legalPersonIdCard = "请输入18位身份证号";
      if (basic.legalPersonPhone && !/^1[3-9]\d{9}$/.test(basic.legalPersonPhone.trim())) e.legalPersonPhone = "法人电话须为11位手机号";
      if (basic.companyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(basic.companyEmail.trim())) e.companyEmail = "公司邮箱格式不正确";
      const normalizedTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
      if (normalizedTags.length < 2) e.tags = "请至少选择 2 个业务标签";
      else if (normalizedTags.length > 8) e.tags = "最多选择 8 个业务标签";
    }
    if (targetStep === 2) {
      const contactEmptyRow = (c: ContactRow) => !c.name.trim() && !c.gender && !c.phone.trim() && !c.idCard.trim() && !c.email.trim() && !c.position.trim();
      const ok = contacts.some((c) => c.name.trim() && /^1[3-9]\d{9}$/.test(c.phone.trim()) && /^\d{17}[\dXx]$/.test(c.idCard.trim()));
      if (!ok) e.contacts = "请至少完整填写 1 个联系人（姓名 + 11位手机号 + 18位身份证号）";
      const primaryContacts = contacts.filter((contact) => contact.isPrimary);
      if (primaryContacts.length !== 1) e.contacts = "请指定且只能指定 1 名主要联系人";
      else if (primaryContacts[0].phone.trim() !== registrationPhone.trim()) {
        e.contacts = "主要联系人手机号须与注册验证手机号一致";
      }
      contacts.forEach((c, i) => {
        if (contactEmptyRow(c)) return; // 全空行提交时过滤
        if (!c.name.trim()) e[`contact-${i}-name`] = "请输入姓名";
        if (!c.phone.trim()) e[`contact-${i}-phone`] = "请输入手机号";
        else if (!/^1[3-9]\d{9}$/.test(c.phone.trim())) e[`contact-${i}-phone`] = "手机号格式不正确";
        if (!c.idCard.trim()) e[`contact-${i}-idCard`] = "请输入身份证号";
        else if (!/^\d{17}[\dXx]$/.test(c.idCard.trim())) e[`contact-${i}-idCard`] = "身份证号须为18位";
        if (c.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) e[`contact-${i}-email`] = "邮箱格式不正确";
      });
    }
    if (targetStep === 3) {
      banks.forEach((b, i) => {
        if (!b.accountName.trim() && !b.bankName.trim() && !b.bankBranch.trim() && !b.accountNo.trim()) return; // 全空行提交时过滤
        if (!b.accountName.trim()) e[`bank-${i}-accountName`] = "请输入户名";
        if (!b.bankName.trim()) e[`bank-${i}-bankName`] = "请输入开户银行";
        if (!b.accountNo.trim()) e[`bank-${i}-accountNo`] = "请输入银行账号";
      });
      const lic = quals[0];
      if (!lic?.name.trim() || !lic.fileUrl) e.license = "营业执照为必填资质，请填写名称并上传文件";
      if (lic?.validFrom && lic?.validTo && lic.validFrom > lic.validTo) e[`qual-0-validTo`] = "有效期止须晚于有效期起";
      quals.forEach((q, i) => {
        if (i === 0) return;
        if (!q.type && !q.name.trim() && !q.fileUrl && !q.validFrom && !q.validTo && q.attachments.length === 0) return; // 全空行提交时过滤
        if (!q.type) e[`qual-${i}-type`] = "请选择资质类型";
        if (!q.name.trim()) e[`qual-${i}-name`] = "请输入资质名称";
        if (!q.fileUrl) e[`qual-${i}-fileUrl`] = "请上传资质文件";
        if (q.validFrom && q.validTo && q.validFrom > q.validTo) e[`qual-${i}-validTo`] = "有效期止须晚于有效期起";
      });
      perfs.forEach((p, i) => {
        if (!p.projectName.trim() && !p.clientName.trim() && !p.contractAmount.trim() && !p.signDate && !p.description.trim() && p.proofFiles.length === 0) return; // 全空行提交时过滤
        if (!p.projectName.trim()) e[`perf-${i}-projectName`] = "项目名称必填";
        if (p.proofFiles.length === 0) e[`perf-${i}-proofFiles`] = "须上传至少 1 份证明材料";
      });
    }
    setErrors(e);
    const first = Object.values(e)[0];
    if (first) { toast.warning(first); focusFirstError(); return false; }
    return true;
  }

  function nextStep() {
    if (step === 1) {
      if (creditCodeDuplicate) { toast.error("统一社会信用代码重复，无法进入下一步"); return; }
      if (legalIdCardDuplicate) { toast.warning("法定代表人身份证号已存在，请核对"); return; }
    }
    if (!validate()) return;
    setErrors({});
    setStep((current) => {
      const next = Math.min(current + 1, STEPS.length - 1);
      setMaxVisitedStep((visited) => Math.max(visited, next));
      return next;
    });
  }
  function prevStep() { setStep((s) => Math.max(s - 1, 0)); }

  /* ── 提交 ── */
  async function submit() {
    setSubmissionError("");
    for (let targetStep = 0; targetStep < STEPS.length - 1; targetStep += 1) {
      if (!validate(targetStep)) {
        setStep(targetStep);
        return;
      }
    }
    if (!agree) {
      const message = "请先阅读并同意《供应商注册入驻协议》";
      setSubmissionError(message);
      toast.warning(message);
      return;
    }
    const contactIdCards = contacts.map((c) => c.idCard.trim()).filter(Boolean);
    try {
      const dup = await authApi.checkDuplicate({
        creditCode: basic.creditCode.trim(),
        legalPersonIdCard: basic.legalPersonIdCard.trim(),
        contactIdCard: contactIdCards[0],
      });
      if (dup.creditCode) { toast.error("统一社会信用代码重复，无法注册，请核对后重试"); return; }
      if (dup.legalPersonIdCard) { toast.warning("法定代表人身份证号已存在，请核对"); return; }
      if (dup.contactIdCard) { toast.warning("联系人身份证号已存在，请核对"); return; }
    } catch { /* 不阻塞 */ }

    setLoading(true);
    try {
      await authApi.register({
        username: basic.creditCode.trim(), // 用户名 = 统一社会信用代码（机构代码）
        registrationPhone: registrationPhone.trim(),
        registrationCode: registrationCode.trim(),
        // 账号展示名取主要联系人（第二步），邮箱同
        displayName: (contacts.find((c) => c.isPrimary && c.name.trim()) || contacts.find((c) => c.name.trim()))?.name.trim() || basic.legalPerson.trim(),
        password: account.password,
        email: (contacts.find((c) => c.isPrimary && c.email.trim()) || contacts.find((c) => c.email.trim()))?.email.trim() || undefined,
        name: basic.name.trim(),
        creditCode: basic.creditCode.trim(),
        enterpriseType: basic.enterpriseType,
        legalPerson: basic.legalPerson.trim(),
        legalPersonIdCard: basic.legalPersonIdCard.trim(),
        registeredAddress: basic.registeredAddress.trim(),
        businessScope: basic.businessScope.trim(),
        logoUrl: basic.logoUrl || undefined,
        country: basic.country.trim() || undefined,
        region: basic.region.trim() || undefined,
        detailedAddress: basic.detailedAddress.trim() || undefined,
        registeredCapital: basic.registeredCapital.trim() || undefined,
        industry: basic.industry.trim() || undefined,
        legalPersonPhone: basic.legalPersonPhone.trim() || undefined,
        companyEmail: basic.companyEmail.trim() || undefined,
        companyWebsite: basic.companyWebsite.trim() || undefined,
        tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
        contacts: contacts
          .filter((c) => c.name.trim() || c.gender || c.phone.trim() || c.idCard.trim() || c.email.trim() || c.position.trim())
          .map((c) => ({
            name: c.name.trim(), gender: c.gender || undefined, phone: c.phone.trim(),
            idCard: c.idCard.trim(), email: c.email || undefined, position: c.position || undefined, isPrimary: c.isPrimary,
          })),
        qualifications: quals.filter((q, i) => i === 0 || q.type || q.name.trim() || q.fileUrl || q.validFrom || q.validTo || q.attachments.length > 0).map((q) => ({
          type: q.type, name: q.name.trim(), fileUrl: q.fileUrl,
          attachments: q.attachments.length ? q.attachments : undefined,
          validFrom: q.validFrom || undefined, validTo: q.validTo || undefined,
        })),
        bankAccounts: banks.filter((b) => b.accountName.trim() || b.bankName.trim() || b.bankBranch.trim() || b.accountNo.trim()).map((b) => ({
          accountName: b.accountName.trim(), bankName: b.bankName.trim(), bankBranch: b.bankBranch.trim() || undefined,
          accountNo: b.accountNo.trim(), isDefault: b.isDefault,
        })),
        performances: perfs.filter((p) => p.projectName.trim() || p.clientName.trim() || p.contractAmount.trim() || p.signDate || p.description.trim() || p.proofFiles.length > 0).map((p) => ({
          projectName: p.projectName.trim(), clientName: p.clientName.trim() || undefined,
          contractAmount: p.contractAmount.trim() || undefined, signDate: p.signDate || undefined,
          description: p.description.trim() || undefined, proofFiles: p.proofFiles,
        })),
      });
      draft.clearDraft();
      toast.success("注册申请已提交，请耐心等待采购中心审核（通常 3 个工作日内）");
      router.push(`/login?registered=1&creditCode=${encodeURIComponent(basic.creditCode)}`);
    } catch (error: unknown) {
      const message = getErrorMessage(error, "注册失败，请检查信息后重试");
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  /* ── logo 上传 ── */
  const logoInputRef = useRef<HTMLInputElement>(null);
  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.warning("logo 图片不能超过5MB"); return; }
    try {
      const asset = await uploadRegistrationFile(file, "general", {
        phone: registrationPhone,
        code: registrationCode,
      });
      const nextPreviewUrl = replaceObjectUrlPreview(file, logoPreviewUrlRef.current);
      logoPreviewUrlRef.current = nextPreviewUrl;
      setLogoPreviewUrl(nextPreviewUrl);
      setBasic((b) => ({ ...b, logoUrl: asset.url }));
      toast.success("logo 已上传");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "logo 上传失败"));
    }
  }

  const item = (prop: string, label: string, node: React.ReactNode, required = false) => (
    <RegistrationField id={`register-${prop}`} label={label} error={errors[prop]} required={required}>
      {node}
    </RegistrationField>
  );
  const inp = (v: string, set: (s: string) => void, ph: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="reg-inp" value={v} placeholder={ph} onChange={(e) => set(e.target.value)} {...extra} />
  );
  const errCls = (key: string) => (errors[key] ? " is-err" : "");
  const rowErrText = (prefix: string, i: number) =>
    Object.entries(errors).filter(([k]) => k.startsWith(`${prefix}${i}-`)).map(([, v]) => v).join("；");

  const filledTags = tags.filter((t) => t.trim());

  const recoveryNotice = showRecovery ? (
    <div className="reg-recovery" role="status">
      <div className="reg-recovery-icon" aria-hidden="true"><Download size={20} strokeWidth={1.6} /></div>
      <div className="reg-recovery-body">
        <p className="reg-recovery-title">检测到 {draftTimeLabel} 有未完成的注册草稿</p>
        <p className="reg-recovery-hint">草稿仅存于本机浏览器，恢复不会读取他人内容</p>
      </div>
      <div className="reg-recovery-actions">
        <button type="button" className="reg-btn reg-btn--ghost" onClick={discardRecovery}>重新开始</button>
        <button type="button" className="reg-btn reg-btn--primary-sm" onClick={acceptRecovery}>继续填写</button>
      </div>
    </div>
  ) : undefined;

  const registrationActions = (
    <>
      {step > 0 && (
        <button type="button" className="reg-btn reg-btn--back" onClick={prevStep}>
          <ArrowLeft size={16} aria-hidden="true" />上一步
        </button>
      )}
      <span className="reg-actions-spacer" />
      {step < STEPS.length - 1 && (
        <button type="button" className="reg-btn reg-btn--primary" onClick={nextStep}>
          下一步<ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
      {step === STEPS.length - 1 && (
        <button type="button" className="reg-btn reg-btn--primary" disabled={loading} onClick={submit}>
          {!loading && <CheckCircle2 size={16} aria-hidden="true" />}
          {loading ? "提交中…" : "提交注册申请"}
        </button>
      )}
    </>
  );

  return (
    <RegistrationShell
      title="供应商正式注册"
      subtitle="分五步完成完整资料入库，提交后由采购中心审核"
      formLabel="供应商正式注册表单"
      steps={STEPS}
      currentStep={step}
      maxVisitedStep={maxVisitedStep}
      onStepChange={(nextStep) => { setStep(nextStep); setErrors({}); }}
      notice={recoveryNotice}
      actions={registrationActions}
    >
      {/* 1 · 身份与账号 */}
      <div className="reg-step-pane" hidden={step !== 0}>
        <div className="reg-form">
          <RegistrationSection icon={KeyRound} title="身份与账号" hint="手机号验证后设置登录密码">
            <div className="reg-form-grid">
              {item("registrationPhone", "注册手机号", inp(registrationPhone, setRegistrationPhone, "用于接收注册验证码", { maxLength: 11, inputMode: "numeric", autoComplete: "tel" }), true)}
              {item("registrationCode", "短信验证码", (
                <div className="reg-code-row">
                  <input id="register-registrationCode" className="reg-inp" value={registrationCode} placeholder="6 位验证码" maxLength={6} inputMode="numeric" autoComplete="one-time-code"
                    onChange={(e) => setRegistrationCode(e.target.value.replace(/\D/g, ""))} />
                  <button type="button" className="reg-btn reg-btn--ghost-sm reg-code-btn" disabled={codeSending || codeCooldown > 0} onClick={sendRegCode}>
                    {codeSending ? "发送中…" : codeCooldown > 0 ? `${codeCooldown}s` : "获取验证码"}
                  </button>
                </div>
              ), true)}
              <PasswordField
                label="登录密码"
                value={account.password}
                onChange={(password) => setAccount((current) => ({ ...current, password }))}
                error={errors.password}
                placeholder="至少 8 位，同时包含字母和数字"
                required
              />
              <PasswordField
                label="确认密码"
                value={account.confirmPassword}
                onChange={(confirmPassword) => setAccount((current) => ({ ...current, confirmPassword }))}
                error={errors.confirmPassword}
                placeholder="请再次输入登录密码"
                required
              />
            </div>
          </RegistrationSection>
        </div>
      </div>

      {/* 2 · 企业与业务 */}
      <div className="reg-step-pane" hidden={step !== 1}>
        <div className="reg-form">
          <RegistrationSection icon={Building2} title="企业信息" hint="请按营业执照如实填写">
                <div className="reg-item">
                  <label className="reg-label">公司 logo</label>
                  <button type="button" className="reg-logo-drop" onClick={() => logoInputRef.current?.click()}
                    aria-label={basic.logoUrl ? "更换公司 logo" : "上传公司 logo"}>
                    {logoPreviewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreviewUrl} alt="公司 logo 本地预览" className="reg-logo-preview" />
                    ) : (
                      <span className="reg-logo-ph"><ImagePlus size={22} strokeWidth={1.75} /></span>
                    )}
                    <span className="reg-logo-meta">
                      <strong>{basic.logoUrl ? "已上传，点击更换" : "点击上传公司 logo"}</strong>
                      <span>支持 png / jpg，≤5MB</span>
                    </span>
                  </button>
                  <input ref={logoInputRef} type="file" hidden accept=".png,.jpg,.jpeg" onChange={pickLogo} />
                </div>

                <div className="reg-form-grid">
                  {item("name", "公司名称", inp(basic.name, (s) => setBasic((b) => ({ ...b, name: s })), "营业执照上的企业全称"), true)}
                  {item("creditCode", "统一社会信用代码（登录账号）", inp(basic.creditCode, (s) => setBasic((b) => ({ ...b, creditCode: s.toUpperCase() })), "18 位代码，注册后作为登录账号", { maxLength: 18, onBlur: checkCreditCode }), true)}
                  {item("country", "国别", inp(basic.country, (s) => setBasic((b) => ({ ...b, country: s })), "中国"))}
                  {item("region", "所属行政区域", inp(basic.region, (s) => setBasic((b) => ({ ...b, region: s })), "如：四川省/成都市/双流区"))}
                  {item("registeredCapital", "注册资本", inp(basic.registeredCapital, (s) => setBasic((b) => ({ ...b, registeredCapital: s })), "如：5000 万元"))}
                  {item("enterpriseType", "公司体制类型", (
                    <select className="reg-sel" value={basic.enterpriseType} onChange={(e) => setBasic((b) => ({ ...b, enterpriseType: e.target.value }))}>
                      <option value="" disabled>请选择</option>
                      {ENTERPRISE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ), true)}
                  {item("industry", "所属行业", (
                    <>
                      <input className="reg-inp" list="reg-industry-list" value={basic.industry} placeholder="下拉选择或自行输入"
                        onChange={(e) => setBasic((b) => ({ ...b, industry: e.target.value }))} />
                      <datalist id="reg-industry-list">
                        {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o} />)}
                      </datalist>
                    </>
                  ))}
                  {item("registeredAddress", "注册地址", inp(basic.registeredAddress, (s) => setBasic((b) => ({ ...b, registeredAddress: s })), "营业执照登记地址"), true)}
                </div>
                {item("detailedAddress", "详细地址", inp(basic.detailedAddress, (s) => setBasic((b) => ({ ...b, detailedAddress: s })), "实际办公/经营详细地址"))}
                {item("businessScope", "经营范围", (
                  <textarea className="reg-inp" rows={3} value={basic.businessScope} placeholder="请输入经营范围" onChange={(e) => setBasic((b) => ({ ...b, businessScope: e.target.value }))} />
                ), true)}
          </RegistrationSection>

          <RegistrationSection icon={ShieldCheck} title="法人信息" hint="须与营业执照登记一致">
                <div className="reg-grid-3">
                  {item("legalPerson", "法人姓名", inp(basic.legalPerson, (s) => setBasic((b) => ({ ...b, legalPerson: s })), "法定代表人姓名"), true)}
                  {item("legalPersonIdCard", "身份证号", inp(basic.legalPersonIdCard, (s) => setBasic((b) => ({ ...b, legalPersonIdCard: s })), "18位身份证号", { maxLength: 18, onBlur: checkLegalIdCard }), true)}
                  {item("legalPersonPhone", "联系电话", inp(basic.legalPersonPhone, (s) => setBasic((b) => ({ ...b, legalPersonPhone: s })), "11位手机号", { maxLength: 11 }))}
                </div>
          </RegistrationSection>

          <RegistrationSection icon={Mail} title="公司联系方式" hint="选填，用于平台沟通">
                <div className="reg-form-grid">
                  {item("companyEmail", "公司邮箱", inp(basic.companyEmail, (s) => setBasic((b) => ({ ...b, companyEmail: s })), "如：service@company.cn"))}
                  {item("companyWebsite", "公司官网地址", inp(basic.companyWebsite, (s) => setBasic((b) => ({ ...b, companyWebsite: s })), "如：https://www.company.cn"))}
                </div>
          </RegistrationSection>

          <RegistrationSection icon={Tags} title="业务标签" hint="用于采购需求与供应商能力匹配">
            <BusinessTagField value={tags} options={tagOptions} onChange={setTags} error={errors.tags} />
          </RegistrationSection>
        </div>
      </div>

            {/* 3 · 联系人 */}
            <div className="reg-step-pane" hidden={step !== 2}>
              <div className="reg-form">
              <section className="reg-block">
                <div className="reg-block-head">
                  <h2 className="reg-block-title">联系人信息</h2>
                  <span className="reg-hint">至少 1 个完整联系人（姓名+手机号+身份证号）</span>
                  <button type="button" className="reg-btn reg-btn--ghost-sm"
                    onClick={() => setContacts((cs) => [...cs, { name: "", gender: "", phone: "", idCard: "", email: "", position: "", isPrimary: false }])}>
                    <Plus size={13} />添加联系人
                  </button>
                </div>
                {contacts.map((c, i) => (
                  <div key={i} className="reg-row">
                    <span className="reg-row-idx">{i + 1}</span>
                    <div className="reg-row-fields reg-row-fields--qual">
                      <input id={`contact-${i}-name`} className={`reg-inp reg-row-input${errCls(`contact-${i}-name`)}`} aria-label={`联系人 ${i + 1} 姓名`} aria-invalid={Boolean(errors[`contact-${i}-name`])} aria-describedby={errors[`contact-${i}-name`] ? `contact-${i}-errors` : undefined} placeholder="姓名" value={c.name} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <select className="reg-sel reg-row-gender" value={c.gender} aria-label="性别" onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, gender: e.target.value } : x)))}>
                        <option value="">性别</option>
                        <option value="男">男</option>
                        <option value="女">女</option>
                      </select>
                      <input id={`contact-${i}-phone`} className={`reg-inp reg-row-input${errCls(`contact-${i}-phone`)}`} aria-label={`联系人 ${i + 1} 电话`} aria-invalid={Boolean(errors[`contact-${i}-phone`])} aria-describedby={errors[`contact-${i}-phone`] ? `contact-${i}-errors` : undefined} placeholder="联系电话" maxLength={11} inputMode="tel" value={c.phone} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                      <input id={`contact-${i}-idCard`} className={`reg-inp reg-row-input${errCls(`contact-${i}-idCard`)}`} aria-label={`联系人 ${i + 1} 身份证号`} aria-invalid={Boolean(errors[`contact-${i}-idCard`])} aria-describedby={errors[`contact-${i}-idCard`] ? `contact-${i}-errors` : undefined} placeholder="身份证号" maxLength={18} value={c.idCard} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, idCard: e.target.value } : x)))} />
                      <input id={`contact-${i}-email`} className={`reg-inp reg-row-input${errCls(`contact-${i}-email`)}`} aria-label={`联系人 ${i + 1} 邮箱`} aria-invalid={Boolean(errors[`contact-${i}-email`])} aria-describedby={errors[`contact-${i}-email`] ? `contact-${i}-errors` : undefined} placeholder="邮箱（选填）" type="email" value={c.email} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                      <input className="reg-inp reg-row-input" aria-label={`联系人 ${i + 1} 部门职务`} placeholder="部门职务" value={c.position} onChange={(e) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)))} />
                      <label className="reg-row-switch">
                        <span className="reg-row-switch-label">主要联系人</span>
                        <SpSwitch checked={c.isPrimary} onChange={(v) => setContacts((cs) => cs.map((x, j) => ({
                          ...x,
                          isPrimary: j === i ? v : v ? false : x.isPrimary,
                        })))} ariaLabel={`设联系人 ${i + 1} 为主要联系人`} />
                      </label>
                      {rowErrText("contact-", i) && <div id={`contact-${i}-errors`} className="reg-row-errors" role="alert">{rowErrText("contact-", i)}</div>}
                    </div>
                    <button type="button" className="reg-row-remove" disabled={contacts.length <= 1} onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))} aria-label="删除联系人">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {errors.contacts && <span className="reg-error-text" role="alert">{errors.contacts}</span>}
              </section>
              </div>
            </div>

            {/* 4 · 资质与履历 */}
            <div className="reg-step-pane" hidden={step !== 3}>
              <div className="reg-form reg-stage-stack">
              <section className="reg-block">
                <div className="reg-block-head">
                  <h2 className="reg-block-title">银行账户信息</h2>
                  <span className="reg-hint">选填；填写则户名/开户银行/账号必填</span>
                  <button type="button" className="reg-btn reg-btn--ghost-sm"
                    onClick={() => setBanks((bs) => [...bs, { accountName: basic.name, bankName: "", bankBranch: "", accountNo: "", isDefault: bs.length === 0 }])}>
                    <Plus size={13} />添加账户
                  </button>
                </div>
                {banks.length === 0 && (
                  <div className="sp-empty-panel">
                    <div className="sp-empty-icon"><Building2 size={22} strokeWidth={1.75} /></div>
                    <div className="sp-empty-text">暂无银行账户</div>
                    <div className="sp-empty-desc">可点击“添加账户”填写对公账户信息</div>
                  </div>
                )}
                {banks.map((b, i) => (
                  <div key={i} className="reg-row">
                    <span className="reg-row-idx">{i + 1}</span>
                    <div className="reg-row-fields reg-row-fields--qual">
                      <input id={`bank-${i}-accountName`} className={`reg-inp reg-row-input${errCls(`bank-${i}-accountName`)}`} aria-label={`账户 ${i + 1} 户名`} aria-invalid={Boolean(errors[`bank-${i}-accountName`])} aria-describedby={errors[`bank-${i}-accountName`] ? `bank-${i}-errors` : undefined} placeholder="户名" value={b.accountName} onChange={(e) => setBanks((bs) => bs.map((x, j) => (j === i ? { ...x, accountName: e.target.value } : x)))} />
                      <input id={`bank-${i}-bankName`} className={`reg-inp reg-row-input${errCls(`bank-${i}-bankName`)}`} aria-label={`账户 ${i + 1} 开户银行`} aria-invalid={Boolean(errors[`bank-${i}-bankName`])} aria-describedby={errors[`bank-${i}-bankName`] ? `bank-${i}-errors` : undefined} placeholder="开户银行" value={b.bankName} onChange={(e) => setBanks((bs) => bs.map((x, j) => (j === i ? { ...x, bankName: e.target.value } : x)))} />
                      <input className="reg-inp reg-row-input" aria-label={`账户 ${i + 1} 开户支行`} placeholder="开户支行（选填）" value={b.bankBranch} onChange={(e) => setBanks((bs) => bs.map((x, j) => (j === i ? { ...x, bankBranch: e.target.value } : x)))} />
                      <input id={`bank-${i}-accountNo`} className={`reg-inp reg-row-input${errCls(`bank-${i}-accountNo`)}`} aria-label={`账户 ${i + 1} 银行账号`} aria-invalid={Boolean(errors[`bank-${i}-accountNo`])} aria-describedby={errors[`bank-${i}-accountNo`] ? `bank-${i}-errors` : undefined} placeholder="银行账号" inputMode="numeric" value={b.accountNo} onChange={(e) => setBanks((bs) => bs.map((x, j) => (j === i ? { ...x, accountNo: e.target.value } : x)))} />
                      <label className="reg-row-switch">
                        <span className="reg-row-switch-label">默认账户</span>
                        <SpSwitch checked={b.isDefault} onChange={(v) => setBanks((bs) => bs.map((x, j) => (j === i ? { ...x, isDefault: v } : x)))} ariaLabel={`设账户 ${i + 1} 为默认账户`} />
                      </label>
                      {rowErrText("bank-", i) && <div id={`bank-${i}-errors`} className="reg-row-errors" role="alert">{rowErrText("bank-", i)}</div>}
                    </div>
                    <button type="button" className="reg-row-remove" onClick={() => setBanks((bs) => bs.filter((_, j) => j !== i))} aria-label="删除账户">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </section>

            {/* 资质信息 */}
              <section className="reg-block">
                <div className="reg-block-head">
                  <h2 className="reg-block-title">资质材料</h2>
                  <span className="reg-hint">营业执照必填，其余可添加；均可附加多份材料</span>
                  <button type="button" className="reg-btn reg-btn--ghost-sm"
                    onClick={() => setQuals((qs) => [...qs, { type: "", name: "", fileUrl: "", attachments: [], validFrom: "", validTo: "" }])}>
                    <Plus size={13} />添加资质
                  </button>
                </div>
                {quals.map((q, i) => (
                  <div key={i} className="reg-row reg-row--stack">
                    <div className="reg-row-line">
                    <span className="reg-row-idx">{i + 1}</span>
                    <div className="reg-row-fields reg-row-fields--qual">
                      <select id={`qual-${i}-type`} className={`reg-sel reg-row-sel${errCls(`qual-${i}-type`)}`} value={q.type} disabled={i === 0} aria-label={`资质 ${i + 1} 类型`} aria-invalid={Boolean(errors[`qual-${i}-type`])} aria-describedby={errors[`qual-${i}-type`] ? `qual-${i}-errors` : undefined}
                        onChange={(e) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                        {i === 0 ? (
                          <option value="营业执照">营业执照</option>
                        ) : (
                          <>
                            <option value="" disabled>请选择资质类型</option>
                            {QUAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </>
                        )}
                      </select>
                      <input id={`qual-${i}-name`} className={`reg-inp reg-row-input${errCls(`qual-${i}-name`)}`} aria-label={`资质 ${i + 1} 名称`} aria-invalid={Boolean(errors[`qual-${i}-name`])} aria-describedby={errors[`qual-${i}-name`] || (i === 0 && errors.license) ? `qual-${i}-errors` : undefined} placeholder={i === 0 ? "营业执照名称（必填）" : "资质名称"} value={q.name}
                        onChange={(e) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <input type="date" className="reg-date reg-row-date" value={q.validFrom} aria-label="有效期起" onChange={(e) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, validFrom: e.target.value } : x)))} />
                      <input id={`qual-${i}-validTo`} type="date" className={`reg-date reg-row-date${errCls(`qual-${i}-validTo`)}`} value={q.validTo} aria-label="有效期止" aria-invalid={Boolean(errors[`qual-${i}-validTo`])} aria-describedby={errors[`qual-${i}-validTo`] ? `qual-${i}-errors` : undefined} onChange={(e) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, validTo: e.target.value } : x)))} />
                      <span className={errors[`qual-${i}-fileUrl`] || (i === 0 && errors.license) ? "reg-file-err" : undefined}>
                        <SingleFile
                          url={q.fileUrl}
                          credentials={{ phone: registrationPhone, code: registrationCode }}
                          onPicked={(a) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, fileUrl: a?.url || "" } : x)))}
                        />
                      </span>
                    </div>
                    <button type="button" className="reg-row-remove" disabled={i === 0}
                      onClick={() => { if (i === 0) return; setQuals((qs) => qs.filter((_, j) => j !== i)); }} aria-label="删除资质">
                      <Trash2 size={14} />
                    </button>
                    </div>
                    <div className="reg-attach-wrap">
                      <MultiFiles
                        value={q.attachments}
                        credentials={{ phone: registrationPhone, code: registrationCode }}
                        onChange={(v) => setQuals((qs) => qs.map((x, j) => (j === i ? { ...x, attachments: v } : x)))}
                        label="附加材料"
                      />
                    </div>
                    {(i === 0 && errors.license || rowErrText("qual-", i)) && (
                      <span id={`qual-${i}-errors`} className="reg-error-text" role="alert">{[i === 0 ? errors.license : "", rowErrText("qual-", i)].filter(Boolean).join("；")}</span>
                    )}
                  </div>
                ))}
              </section>

            {/* 主体业绩 */}
              <section className="reg-block">
                <div className="reg-block-head">
                  <h2 className="reg-block-title">主体业绩</h2>
                  <span className="reg-hint">选填；每项须上传证明材料</span>
                  <button type="button" className="reg-btn reg-btn--ghost-sm"
                    onClick={() => setPerfs((ps) => [...ps, { projectName: "", clientName: "", contractAmount: "", signDate: "", description: "", proofFiles: [] }])}>
                    <Plus size={13} />添加业绩
                  </button>
                </div>
                {perfs.length === 0 && (
                  <div className="sp-empty-panel">
                    <div className="sp-empty-icon"><Building2 size={22} strokeWidth={1.75} /></div>
                    <div className="sp-empty-text">暂无业绩</div>
                    <div className="sp-empty-desc">可点击“添加业绩”填写代表性项目（含证明材料）</div>
                  </div>
                )}
                {perfs.map((p, i) => (
                  <div key={i} className="reg-perf-card">
                    <div className="reg-perf-head">
                      <span className="reg-perf-idx">业绩 {i + 1}</span>
                      <button type="button" className="reg-row-remove" onClick={() => setPerfs((ps) => ps.filter((_, j) => j !== i))} aria-label="删除业绩">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="reg-form-grid">
                      {item(`perf-${i}-projectName`, "项目名称", inp(p.projectName, (s) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, projectName: s } : x))), "如：XX水库泵站设备供货项目"), true)}
                      {item(`perf-x-${i}-client`, "业主/客户", inp(p.clientName, (s) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, clientName: s } : x))), "选填"))}
                      {item(`perf-x-${i}-amount`, "合同金额", inp(p.contractAmount, (s) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, contractAmount: s } : x))), "如：940 万元"))}
                      {item(`perf-x-${i}-date`, "签订日期", <input type="date" className="reg-inp" value={p.signDate} onChange={(e) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, signDate: e.target.value } : x)))} />)}
                    </div>
                    {item(`perf-x-${i}-desc`, "业绩描述", (
                      <textarea className="reg-inp" rows={2} value={p.description} placeholder="选填：供货范围/工程内容等"
                        onChange={(e) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    ))}
                    <div className={`reg-item${errors[`perf-${i}-proofFiles`] ? " has-error" : ""}`}>
                      <label className="reg-label">证明材料 <i style={{ color: "var(--danger)", fontStyle: "normal" }}>*</i></label>
                      <MultiFiles
                        value={p.proofFiles}
                        credentials={{ phone: registrationPhone, code: registrationCode }}
                        onChange={(v) => setPerfs((ps) => ps.map((x, j) => (j === i ? { ...x, proofFiles: v } : x)))}
                        label="上传证明材料"
                      />
                      {errors[`perf-${i}-proofFiles`] && <span className="reg-error-text" role="alert">{errors[`perf-${i}-proofFiles`]}</span>}
                    </div>
                  </div>
                ))}
              </section>
              </div>
            </div>

            {/* 5 · 确认提交 */}
            <div className="reg-step-pane" hidden={step !== 4}>
              <div className="reg-ov-sec">
                <h4>身份与账号</h4>
                <dl className="reg-ov-grid">
                  <div className="reg-ov-item"><dt>注册手机号</dt><dd>{registrationPhone || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>登录用户名（统一社会信用代码）</dt><dd className="reg-mono">{basic.creditCode || "未填写"}</dd></div>
                </dl>
              </div>
              <div className="reg-ov-sec">
                <h4>企业与业务</h4>
                {logoPreviewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreviewUrl} alt="公司 logo 本地预览" className="reg-logo-preview reg-ov-logo" />
                )}
                <dl className="reg-ov-grid">
                  <div className="reg-ov-item"><dt>公司名称</dt><dd>{basic.name || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>统一社会信用代码</dt><dd className="reg-mono">{basic.creditCode || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>国别 / 行政区域</dt><dd>{basic.country || "未填写"} / {basic.region || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>注册地址</dt><dd>{basic.registeredAddress || "未填写"}{basic.detailedAddress ? `（${basic.detailedAddress}）` : ""}</dd></div>
                  <div className="reg-ov-item"><dt>注册资本 / 行业</dt><dd>{basic.registeredCapital || "未填写"} / {basic.industry || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>体制类型</dt><dd>{basic.enterpriseType || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>法人</dt><dd>{basic.legalPerson || "未填写"}{basic.legalPersonPhone ? ` · ${basic.legalPersonPhone}` : ""}</dd></div>
                  <div className="reg-ov-item"><dt>公司邮箱 / 官网</dt><dd>{basic.companyEmail || "未填写"} / {basic.companyWebsite || "未填写"}</dd></div>
                  <div className="reg-ov-item"><dt>业务标签</dt><dd>{filledTags.length ? filledTags.map((t) => (inTagPool(t) ? t : `${t}（待审核）`)).join("、") : "未选择"}</dd></div>
                </dl>
              </div>
              <div className="reg-ov-sec">
                <h4>联系人（{contacts.filter((c) => c.name.trim() || c.gender || c.phone.trim() || c.idCard.trim() || c.email.trim() || c.position.trim()).length}）</h4>
                {contacts.filter((c) => c.name.trim() || c.gender || c.phone.trim() || c.idCard.trim() || c.email.trim() || c.position.trim()).map((c, i) => (
                  <p key={i} className="reg-ov-line">{c.name || "未填写"}{c.gender ? ` · ${c.gender}` : ""} · {c.phone || "未填写"}{c.idCard ? ` · 身份证 ${c.idCard}` : ""}{c.position ? ` · ${c.position}` : ""}{c.isPrimary ? " · 主要" : ""}</p>
                ))}
              </div>
              <div className="reg-ov-sec">
                <h4>资质与履历 · 银行账户（{banks.length}）</h4>
                {banks.length === 0 ? <p className="reg-ov-line">未填写</p> : banks.map((b, i) => (
                  <p key={i} className="reg-ov-line">{b.accountName} · {b.bankName}{b.bankBranch ? ` ${b.bankBranch}` : ""} · {b.accountNo}{b.isDefault ? " · 默认" : ""}</p>
                ))}
              </div>
              <div className="reg-ov-sec">
                <h4>资质与履历 · 资质材料（{quals.filter((q) => q.name.trim()).length}）</h4>
                {quals.filter((q) => q.name.trim()).map((q, i) => (
                  <p key={i} className="reg-ov-line">{q.type} · {q.name}{q.fileUrl ? " · 已上传" : ""}{q.attachments.length ? ` · 附加 ${q.attachments.length} 份` : ""}</p>
                ))}
              </div>
              <div className="reg-ov-sec">
                <h4>资质与履历 · 主体业绩（{perfs.filter((p) => p.projectName.trim()).length}）</h4>
                {perfs.filter((p) => p.projectName.trim()).map((p, i) => (
                  <p key={i} className="reg-ov-line">{p.projectName}{p.clientName ? ` · ${p.clientName}` : ""}{p.contractAmount ? ` · ${p.contractAmount}` : ""} · 证明 {p.proofFiles.length} 份</p>
                ))}
              </div>

              <div className="reg-notice">
                <Info size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>提交注册后，系统将自动进入审核流程。审核通过后您将获得完整的使用权限。</span>
              </div>
              <RegisterAgreement value={agree} onChange={setAgree} />
            </div>
            {submissionError && <p className="reg-submit-error" role="alert">{submissionError}</p>}
    </RegistrationShell>
  );
}
