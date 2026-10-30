'use client';

/**
 * 流标决策向导（2026-10-23 统一流，spec 2026-10-23-abort-restart-unification）：
 * Step1 是否继续 → Step2 重启起点三选 + 新轮阶段预览 → [需求/立项起点] Step3 上传新文件
 * → Step4 信息确认。
 * 步骤序裁定（2026-10-30 用户口径）：先选重启步骤、后确认信息——需求/立项起点须先上传
 * 新文件，信息确认页读取新文件解析结果更新字段（extract-demand / extract-initiation，
 * 纯解析零落库）；采购文件起点直接进信息确认，读取上一轮信息。
 * 信息确认设计（2026-10-30 用户口径）：与新建项目弹窗大致一致——字段行 + 逐项 AI 识别
 * （读上传文档原文，aiIdentifyField）+ AI 推荐 + 采购事由/供方要求 AI 优化
 * （polishInitiationField）；采购方式红标强调（chip 格栅）。
 * 入口：流标公告发布后自动弹（向导 onPublished 链）/ 流标提示条「收尾处理」（公告闸后）。
 * 终止分支不在本组件内做——onRequestTerminate 唤起面板既有终止对话框。
 */

import { useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, FileUp, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import { getNonTenderDeal } from '@/lib/api/bid';
import {
  aiIdentifyField,
  extractDemandFields,
  extractInitiationFields,
  polishInitiationField,
  reprocProject,
  uploadProjectStageAttachment,
  type ReprocBody,
} from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_METHOD_STAGES,
  type FieldCandidate,
  type ProjectManagementItem,
} from '@/lib/types/project-management';

type Step = 'ask' | 'start' | 'upload' | 'info';

const START_OPTIONS: Array<{ key: ReprocBody['startStageKey']; label: string; hint: string }> = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求', hint: '从头梳理需求与预算（需上传新的采购需求表）' },
  { key: 'INITIATION', label: '采购立项', hint: '需求沿用，重新立项（需上传新的立项文件）' },
  { key: 'TENDER_DOCUMENT', label: '采购文件', hint: '需求立项沿用，重编采购文件' },
];

/** 信息确认字段：formKey（本表单）/ aiKey（AI 识别与解析端点的业务键）/ label */
const FIELD_DEFS = [
  { formKey: 'requesterName', aiKey: 'requesterName', label: '需求申请人' },
  { formKey: 'requesterDepartment', aiKey: 'requesterDepartment', label: '需求部门' },
  { formKey: 'title', aiKey: 'procurementTitle', label: '采购事项名称' },
  { formKey: 'procurementCategory', aiKey: 'procurementCategory', label: '采购品类' },
  { formKey: 'procurementOrganizationForm', aiKey: 'procurementOrganizationForm', label: '采购组织形式' },
] as const;

/** 多行长文本字段：支持 AI 优化（同新建弹窗） */
const LONG_FIELD_DEFS = [
  { formKey: 'projectReason', aiKey: 'projectReason', label: '采购事由' },
  { formKey: 'supplierRequirements', aiKey: 'supplierRequirements', label: '对供方的要求' },
] as const;

export function AbortRestartDialog({
  isOpen,
  onClose,
  item,
  currentRoundBidProjectId,
  onRequestTerminate,
  onRestarted,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: ProjectManagementItem;
  currentRoundBidProjectId: string | null;
  /** Step1 选「终止」→ 唤起面板既有终止对话框 */
  onRequestTerminate: () => void;
  /** 重启成功回调（面板刷新详情） */
  onRestarted: () => void;
}) {
  const [step, setStep] = useState<Step>('ask');
  const [dealBlocked, setDealBlocked] = useState(false); // C3 非招标成交登记 → 不宜重启
  const [busy, setBusy] = useState(false);

  // 信息确认表单（预填 PMI 当前值；需求/立项起点按新上传文件解析结果覆盖）
  const [form, setForm] = useState<Record<string, string>>({});
  const [budgetInput, setBudgetInput] = useState('');
  const [annualBudget, setAnnualBudget] = useState(true);
  const [method, setMethod] = useState<string>(item.procurementMethod);
  const [startStage, setStartStage] = useState<ReprocBody['startStageKey']>('TENDER_DOCUMENT');

  // Step3 上传新文件（需求/立项起点必经）：解析字段覆盖进信息确认表单；extractedText 供 AI 识别
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState('');
  // 上传的原文件留存（2026-10-30 闭环）：重启成功后自动挂到新一轮起点阶段——
  // extract-* 端点纯解析零落库，文件本体若不回传，新轮起点阶段还需手动再传一次
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [extractedCount, setExtractedCount] = useState(0);

  // AI 识别 / AI 优化（2026-10-30 与新建弹窗同款）
  const [aiLoadingField, setAiLoadingField] = useState<string | null>(null);
  const [aiCandidates, setAiCandidates] = useState<Record<string, FieldCandidate[]>>({});
  const [polishing, setPolishing] = useState<Record<string, boolean>>({});

  const needsUpload = startStage === 'PROCUREMENT_DEMAND' || startStage === 'INITIATION';

  useEffect(() => {
    if (!isOpen) return;
    setStep('ask'); setBusy(false);
    setForm({
      requesterName: item.requesterName ?? '',
      requesterDepartment: item.requesterDepartment ?? '',
      title: item.title ?? '',
      procurementCategory: item.procurementCategory ?? '',
      projectReason: item.projectReason ?? '',
      supplierRequirements: item.supplierRequirements ?? '',
      procurementOrganizationForm: item.procurementOrganizationForm ?? '',
      initiationDate: item.initiationDate ? new Date(item.initiationDate).toISOString().slice(0, 10) : '',
    });
    setBudgetInput(item.budgetAmount != null ? String(item.budgetAmount) : '');
    setAnnualBudget(item.isAnnualBudget ?? true);
    setMethod(item.procurementMethod);
    setStartStage('TENDER_DOCUMENT');
    setUploading(false); setUploadedName(''); setUploadedFile(null); setExtractedText(''); setExtractedCount(0);
    setAiLoadingField(null); setAiCandidates({}); setPolishing({});
    // 先清残留禁用态（null 轮次 BidProject 不触发下方 refetch，不清会跨项目误禁）
    setDealBlocked(false);
    // C3：当前轮已转非招标方式成交 → 不宜重启采购
    if (currentRoundBidProjectId) {
      getNonTenderDeal(currentRoundBidProjectId)
        .then((deal) => setDealBlocked(!!deal))
        .catch(() => setDealBlocked(false));
    }
  }, [isOpen, item, currentRoundBidProjectId]);

  // Step2 新轮阶段预览：按方式模板从起点截取到末尾
  const previewStages = useMemo(() => {
    const tpl = PROCUREMENT_METHOD_STAGES[method as keyof typeof PROCUREMENT_METHOD_STAGES] ?? [];
    const idx = tpl.findIndex((s) => s.key === startStage);
    return idx >= 0 ? tpl.slice(idx) : [];
  }, [method, startStage]);

  const methodChanged = method !== item.procurementMethod;

  /** 上传新文件并解析（extract-* 端点纯解析零落库）：非空字段覆盖进信息确认表单 */
  const handleUploadExtract = async (file: File) => {
    setUploading(true);
    try {
      const result = startStage === 'PROCUREMENT_DEMAND'
        ? await extractDemandFields(file)
        : await extractInitiationFields(file);
      const f = result.fields as Record<string, unknown>;
      let count = 0;
      const put = (formKey: string, v: unknown, origin: unknown) => {
        const s = v == null ? '' : String(v).trim();
        if (!s) return;
        // 只计入与当前值不同（或当前为空）的项——「读取新文件更新信息（若有更新的话）」
        if (s !== (origin == null ? '' : String(origin).trim())) count++;
        setForm((prev) => ({ ...prev, [formKey]: s }));
      };
      put('requesterName', f.requesterName, item.requesterName);
      put('requesterDepartment', f.requesterDepartment, item.requesterDepartment);
      put('title', f.procurementTitle, item.title);
      put('procurementCategory', f.procurementCategory, item.procurementCategory);
      put('projectReason', f.projectReason, item.projectReason);
      put('supplierRequirements', f.supplierRequirements, item.supplierRequirements);
      put('procurementOrganizationForm', f.procurementOrganizationForm, item.procurementOrganizationForm);
      if (f.initiationDate) put('initiationDate', f.initiationDate, item.initiationDate ? new Date(item.initiationDate).toISOString().slice(0, 10) : '');
      if (f.budgetAmount != null && Number.isFinite(Number(f.budgetAmount))) {
        setBudgetInput(String(f.budgetAmount));
        if (Number(f.budgetAmount) !== item.budgetAmount) count++;
      }
      if (typeof f.isAnnualBudget === 'boolean') setAnnualBudget(f.isAnnualBudget);
      setUploadedName(file.name);
      setUploadedFile(file);
      setExtractedText(result.extractedText ?? '');
      setExtractedCount(count);
      setAiCandidates({}); // 新文档 → 旧 AI 推荐作废
      toast.success(`已读取《${file.name}》${count > 0 ? `，更新 ${count} 项信息` : '（信息与当前一致）'}，请核对`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '文件解析失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  /** AI 识别（同新建弹窗）：从上传文档原文识别指定字段，出 AI 推荐候选 */
  const handleAiIdentify = async (formKey: string, aiKey: string) => {
    if (!extractedText) { toast.error('请先上传并解析文件，再使用 AI 识别'); return; }
    setAiLoadingField(formKey);
    try {
      const candidates = await aiIdentifyField(aiKey, extractedText, 3);
      setAiCandidates((prev) => ({ ...prev, [formKey]: candidates }));
      if (!candidates?.length) toast.info('AI 未从文档中识别到该项内容，请手动填写');
    } catch {
      toast.error('AI 识别失败，请手动填写');
    } finally {
      setAiLoadingField(null);
    }
  };

  /** AI 优化（同新建弹窗）：采购事由 / 对供方的要求 基于文档原文润色 */
  const handlePolish = async (field: 'projectReason' | 'supplierRequirements', label: string) => {
    const cur = (form[field] ?? '').trim();
    if (!cur) { toast.error(`请先填写${label}的初步内容，再进行 AI 优化`); return; }
    setPolishing((prev) => ({ ...prev, [field]: true }));
    try {
      const { polished } = await polishInitiationField({
        field,
        text: cur,
        ...(startStage === 'PROCUREMENT_DEMAND'
          ? { demandDocText: extractedText || undefined }
          : { initiationDocText: extractedText || undefined }),
        projectContext: {
          title: form.title || undefined,
          category: form.procurementCategory || undefined,
          method: method || undefined,
        },
      });
      setForm((prev) => ({ ...prev, [field]: polished }));
      toast.success('AI 优化完成');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 优化失败，请稍后重试');
    } finally {
      setPolishing((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      // 差异收集：字符串字段 + 预算 + 年度预算 + 立项日期
      const basicInfo: NonNullable<ReprocBody['basicInfo']> = {};
      const origin: Record<string, unknown> = {
        requesterName: item.requesterName, requesterDepartment: item.requesterDepartment,
        title: item.title, procurementCategory: item.procurementCategory,
        projectReason: item.projectReason, supplierRequirements: item.supplierRequirements,
        procurementOrganizationForm: item.procurementOrganizationForm,
      };
      for (const f of [...FIELD_DEFS, ...LONG_FIELD_DEFS]) {
        const v = (form[f.formKey] ?? '').trim();
        if (v && v !== (origin[f.formKey] ?? '')) basicInfo[f.formKey] = v;
      }
      const budget = Number(budgetInput);
      if (budgetInput.trim() && Number.isFinite(budget) && budget !== item.budgetAmount) basicInfo.budgetAmount = budget;
      if (annualBudget !== item.isAnnualBudget) basicInfo.isAnnualBudget = annualBudget;
      const dateStr = (form.initiationDate ?? '').trim();
      if (dateStr && (!item.initiationDate || dateStr !== new Date(item.initiationDate).toISOString().slice(0, 10))) {
        basicInfo.initiationDate = dateStr;
      }

      const res = await reprocProject(item.id, {
        startStageKey: startStage,
        ...(methodChanged ? { procurementMethod: method } : {}),
        ...(Object.keys(basicInfo).length ? { basicInfo } : {}),
      });
      // 上传的新文件自动挂到新一轮起点阶段（2026-10-30 闭环）：extract 只做解析不落库，
      // 文件本体在此回传——非阻塞，失败仅提示手动补传，不回滚重启。
      if (uploadedFile && needsUpload) {
        try {
          await uploadProjectStageAttachment(item.id, startStage, uploadedFile, res.round);
        } catch (e) {
          toast.error(`新轮阶段已生成，但文件回传「${START_OPTIONS.find((o) => o.key === startStage)?.label}」阶段失败：${e instanceof Error ? e.message : '请手动补传'}`);
        }
      }
      toast.success(`已开启第 ${res.round} 轮采购（${res.inserted} 个阶段），当前步骤：${START_OPTIONS.find((o) => o.key === startStage)?.label ?? ''}`);
      onRestarted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重启失败');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const stepTitle =
    step === 'ask' ? '流标收尾 · 该项采购是否继续？'
    : step === 'start' ? '继续采购 · 选择重启步骤'
    : step === 'upload' ? `继续采购 · 上传${startStage === 'PROCUREMENT_DEMAND' ? '采购需求表' : '立项文件'}`
    : '继续采购 · 确认项目信息';

  /** 字段行（与新建弹窗评审页同款）：标签 + AI 识别钮 + 输入 + AI 推荐候选 */
  const renderAiField = (def: { formKey: string; aiKey: string; label: string }, long = false) => (
    <div key={def.formKey} className={long ? 'sm:col-span-2' : ''}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-[color:var(--foreground)]">{def.label}</span>
        {aiLoadingField === def.formKey ? (
          <span className="neu-btn-xs pointer-events-none text-[var(--accent)]"><Loader2 size={13} className="animate-spin" /></span>
        ) : (
          <button
            type="button"
            title={extractedText ? 'AI 识别：从上传的文档中读取该字段' : '请先在上一步上传并解析文件'}
            disabled={!extractedText}
            onClick={() => void handleAiIdentify(def.formKey, def.aiKey)}
            className="neu-btn-xs text-[var(--accent)] disabled:opacity-40"
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>
      {long ? (
        <div className="flex items-start gap-1.5">
          <textarea
            value={form[def.formKey] ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, [def.formKey]: e.target.value }))}
            className="workbench-input w-full flex-1 min-h-[64px] text-sm"
          />
          <button
            type="button"
            onClick={() => void handlePolish(def.formKey as 'projectReason', def.label)}
            disabled={polishing[def.formKey]}
            title="AI 优化：基于文档原文润色"
            className="neu-btn-xs shrink-0 text-[var(--accent)] disabled:opacity-40"
          >
            {polishing[def.formKey] ? <Loader2 size={13} className="animate-spin" /> : <><Wand2 size={13} className="inline mr-0.5" />AI 优化</>}
          </button>
        </div>
      ) : (
        <input
          value={form[def.formKey] ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, [def.formKey]: e.target.value }))}
          className="workbench-input w-full text-sm"
        />
      )}
      {aiCandidates[def.formKey]?.length ? (
        <div className="mt-1.5 pt-1.5 border-t border-[oklch(0.6_0.04_258/0.16)]">
          <div className="text-[11px] font-medium text-[color:var(--muted-foreground)] mb-1">AI 推荐</div>
          <div className="space-y-1">
            {aiCandidates[def.formKey].map((c, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, [def.formKey]: c.value }))}
                className={[
                  'neu-opt w-full p-1.5 text-left block text-sm',
                  form[def.formKey] === c.value ? 'is-on' : '',
                ].join(' ')}
              >
                <span className="font-medium text-[color:var(--foreground)]">{c.value}</span>
                <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">({(c.confidence * 100).toFixed(0)}%)</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <Modal
      open={isOpen}
      onClose={busy ? () => undefined : onClose}
      size="md"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      footer={
        <div className="neu-btn-group">
          {step === 'ask' ? (
            <>
              <button type="button" onClick={() => onRequestTerminate()} className="neu-btn-soft is-danger">
                <Ban size={14} /> 终止该项采购
              </button>
              <button type="button" onClick={() => setStep('start')} disabled={dealBlocked} className="neu-btn-primary is-water">
                继续采购 <RefreshCw size={14} />
              </button>
            </>
          ) : step === 'start' ? (
            <>
              <button type="button" onClick={() => setStep('ask')} disabled={busy} className="neu-btn-soft">上一步</button>
              <button
                type="button"
                onClick={() => setStep(needsUpload ? 'upload' : 'info')}
                className="neu-btn-primary is-water"
              >
                下一步：{needsUpload ? '上传文件' : '确认信息'}
              </button>
            </>
          ) : step === 'upload' ? (
            <>
              <button type="button" onClick={() => setStep('start')} disabled={busy || uploading} className="neu-btn-soft">上一步</button>
              <button
                type="button"
                onClick={() => setStep('info')}
                disabled={uploading || !uploadedName}
                title={!uploadedName ? '请先上传并解析新文件' : undefined}
                className="neu-btn-primary is-water"
              >
                下一步：确认信息
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep(needsUpload ? 'upload' : 'start')} disabled={busy} className="neu-btn-soft">上一步</button>
              <button type="button" onClick={() => void handleConfirm()} disabled={busy} className="neu-btn-primary is-water">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 确认重启
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <div className="wb-icon-well" style={{ '--well-fg': 'var(--accent)' } as React.CSSProperties}>
          <RefreshCw size={18} strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-base font-bold text-[color:var(--foreground)]">{stepTitle}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{item.title}（第 {item.currentRound ?? 1} 轮已流标）</p>
        </div>
      </div>

      {dealBlocked && step === 'ask' && (
        <div className="wb-alert wb-alert--warning mt-4 text-sm">
          当前轮已登记「转非招标方式成交」，不宜重启采购——可选择终止收尾。
        </div>
      )}

      {step === 'ask' && (
        <div className="mt-4 wb-alert wb-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
          「终止」进入项目终止流程（写入已终止清单，公告下架，不可恢复）；「继续采购」先选择重启步骤，再确认项目信息，生成新一轮采购阶段。
        </div>
      )}

      {step === 'start' && (
        <div className="mt-4 space-y-3">
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">从哪一步开始重启？</span>
          <div className="grid grid-cols-3 gap-2">
            {START_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setStartStage(o.key)}
                className="rounded-[14px] p-3 text-left transition"
                style={{
                  border: `1px solid ${startStage === o.key ? 'var(--accent)' : 'color-mix(in oklch, var(--foreground) 12%, transparent)'}`,
                  background: startStage === o.key ? 'color-mix(in oklch, var(--accent) 8%, transparent)' : undefined,
                }}
              >
                <span className="block text-sm font-bold text-[color:var(--foreground)]">{o.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted-foreground)]">{o.hint}</span>
              </button>
            ))}
          </div>
          <div>
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">
              第 {(item.currentRound ?? 1) + 1} 轮阶段预览（{method}{methodChanged ? ` · 原 ${item.procurementMethod}` : ''}）
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {previewStages.map((s, i) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{ borderColor: 'color-mix(in oklch, var(--foreground) 12%, transparent)' }}>
                  {i + 1}. {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="wb-alert wb-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
            确认后：第 {item.currentRound ?? 1} 轮全部锁定（只读）；删除其开标评标之后的定标/合同等阶段；第 {(item.currentRound ?? 1) + 1} 轮按上列阶段生成，起点步骤立即可操作。
          </div>
        </div>
      )}

      {step === 'upload' && (
        <div className="mt-4 space-y-3">
          <div className="wb-alert wb-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
            从「{START_OPTIONS.find((o) => o.key === startStage)?.label}」重启须上传新的
            {startStage === 'PROCUREMENT_DEMAND' ? '采购需求表' : '立项文件'}（PDF）——
            信息确认页将读取新文件解析结果更新项目信息（若有更新），并支持逐项 AI 识别与 AI 优化。
          </div>
          <label className="neu-drop-zone cursor-pointer">
            {uploading ? (
              <>
                <Loader2 size={22} className="animate-spin text-[var(--accent)] mx-auto mb-2" />
                <p className="text-sm font-semibold text-[var(--foreground)]">正在解析文件…</p>
              </>
            ) : uploadedName ? (
              <>
                <FileUp size={22} className="mx-auto mb-2 text-[var(--success)]" />
                <p className="text-sm font-semibold text-[var(--foreground)]">{uploadedName}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">已解析——可点击重新上传替换</p>
              </>
            ) : (
              <>
                <FileUp size={22} className="mx-auto mb-2 text-[var(--accent)]" />
                <p className="text-sm font-semibold text-[var(--foreground)]">点击上传{startStage === 'PROCUREMENT_DEMAND' ? '采购需求表' : '立项文件'}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">仅支持 PDF，最大 100MB</p>
              </>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleUploadExtract(f);
              }}
            />
          </label>
          {uploadedName && (
            <p className="text-xs text-[var(--muted-foreground)]">
              已按新文件{extractedCount > 0 ? `更新 ${extractedCount} 项信息` : '核对（与当前信息一致）'}，点击「下一步」核对确认。
            </p>
          )}
        </div>
      )}

      {step === 'info' && (
        <div className="mt-4 space-y-4">
          {needsUpload && uploadedName && (
            <p className="text-xs text-[var(--accent-strong)]">
              已读取新上传的《{uploadedName}》{extractedCount > 0 ? `并更新 ${extractedCount} 项信息` : '（信息与当前一致）'}，请核对；各项可点 <Sparkles size={11} className="inline" /> 从文档 AI 识别。
            </p>
          )}
          {!needsUpload && (
            <p className="text-xs text-[var(--muted-foreground)]">已读取上一轮项目信息，请核对确认。</p>
          )}

          {/* 采购方式红标强调区（2026-10-30 用户口径：标红、chip 格栅与新建一致、删「重点确认」字样） */}
          <div className="space-y-2">
            <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--danger)]">采购方式</span>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {PROCUREMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={['neu-opt px-3 py-2.5 text-xs font-semibold', method === m ? 'is-on' : ''].join(' ')}
                  style={method === m ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}
                >
                  {m}
                </button>
              ))}
            </div>
            {methodChanged ? (
              <p className="text-xs font-semibold text-[var(--warning)]">
                采购方式将由「{item.procurementMethod}」变更为「{method}」——第 {(item.currentRound ?? 1) + 1} 轮将按新方式生成阶段。
              </p>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">变更采购方式将按新方式生成新一轮阶段，请谨慎确认。</p>
            )}
          </div>

          <div className="wb-section-rule" />

          {/* 字段区：与新建弹窗评审页同款（标签 + AI 识别 + 输入 + AI 推荐） */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_DEFS.map((f) => renderAiField(f))}
            <div>
              <span className="block mb-1.5 text-xs font-semibold text-[color:var(--foreground)]">采购预算（元）</span>
              <input value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} inputMode="decimal" className="workbench-input w-full text-sm" />
            </div>
            <div>
              <span className="block mb-1.5 text-xs font-semibold text-[color:var(--foreground)]">立项日期</span>
              <input
                type="date"
                value={form.initiationDate ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, initiationDate: e.target.value }))}
                className="workbench-input w-full text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm self-end pb-1.5">
              <input type="checkbox" checked={annualBudget} onChange={(e) => setAnnualBudget(e.target.checked)} />
              年度预算内
            </label>
            {LONG_FIELD_DEFS.map((f) => renderAiField(f, true))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">有修改的字段将更新到项目基本信息；未修改的保持原值。</p>
        </div>
      )}
    </Modal>
  );
}
