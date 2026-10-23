'use client';

/**
 * 流标决策向导（2026-10-23 统一流，spec 2026-10-23-abort-restart-unification）：
 * Step1 是否继续 → Step2 基本信息确认（采购方式重点区）→ Step3 重启起点三选 + 新轮阶段预览。
 * 入口：流标公告发布后自动弹（向导 onPublished 链）/ 流标提示条「收尾处理」（公告闸后）。
 * 终止分支不在本组件内做——onRequestTerminate 唤起面板既有终止对话框。
 */

import { useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import { getNonTenderDeal } from '@/lib/api/bid';
import { reprocProject, type ReprocBody } from '@/lib/api/project-management';
import {
  PROCUREMENT_METHODS,
  PROCUREMENT_METHOD_STAGES,
  type ProjectManagementItem,
} from '@/lib/types/project-management';

type Step = 'ask' | 'info' | 'start';

const START_OPTIONS: Array<{ key: ReprocBody['startStageKey']; label: string; hint: string }> = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求', hint: '从头梳理需求与预算' },
  { key: 'INITIATION', label: '采购立项', hint: '需求沿用，重新立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件', hint: '需求立项沿用，重编采购文件' },
];

const STR_FIELD_DEFS = [
  { key: 'requesterName', label: '申请人' },
  { key: 'requesterDepartment', label: '申请部门' },
  { key: 'title', label: '采购项目名称' },
  { key: 'procurementCategory', label: '采购品类' },
  { key: 'projectReason', label: '采购事由' },
  { key: 'supplierRequirements', label: '对供方的要求' },
  { key: 'procurementOrganizationForm', label: '采购组织形式' },
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

  // Step2 表单（预填 PMI 当前值）
  const [form, setForm] = useState<Record<string, string>>({});
  const [budgetInput, setBudgetInput] = useState('');
  const [annualBudget, setAnnualBudget] = useState(true);
  const [method, setMethod] = useState<string>(item.procurementMethod);
  const [startStage, setStartStage] = useState<ReprocBody['startStageKey']>('TENDER_DOCUMENT');

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
    // 先清残留禁用态（null 轮次 BidProject 不触发下方 refetch，不清会跨项目误禁）
    setDealBlocked(false);
    // C3：当前轮已转非招标方式成交 → 不宜重启采购
    if (currentRoundBidProjectId) {
      getNonTenderDeal(currentRoundBidProjectId)
        .then((deal) => setDealBlocked(!!deal))
        .catch(() => setDealBlocked(false));
    }
  }, [isOpen, item, currentRoundBidProjectId]);

  // Step3 新轮阶段预览：按方式模板从起点截取到末尾
  const previewStages = useMemo(() => {
    const tpl = PROCUREMENT_METHOD_STAGES[method as keyof typeof PROCUREMENT_METHOD_STAGES] ?? [];
    const idx = tpl.findIndex((s) => s.key === startStage);
    return idx >= 0 ? tpl.slice(idx) : [];
  }, [method, startStage]);

  const methodChanged = method !== item.procurementMethod;

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
      for (const f of STR_FIELD_DEFS) {
        const v = (form[f.key] ?? '').trim();
        if (v && v !== (origin[f.key] ?? '')) basicInfo[f.key] = v;
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
              <button type="button" onClick={() => setStep('info')} disabled={dealBlocked} className="neu-btn-primary is-water">
                继续采购 <RefreshCw size={14} />
              </button>
            </>
          ) : step === 'info' ? (
            <>
              <button type="button" onClick={() => setStep('ask')} disabled={busy} className="neu-btn-soft">上一步</button>
              <button type="button" onClick={() => setStep('start')} className="neu-btn-primary is-water">下一步：选择重启步骤</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep('info')} disabled={busy} className="neu-btn-soft">上一步</button>
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
          <h3 className="text-base font-bold text-[color:var(--foreground)]">流标收尾 · 该项采购是否继续？</h3>
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
          「终止」进入项目终止流程（写入已终止清单，公告下架，不可恢复）；「继续采购」将确认项目信息并选择重启步骤，生成新一轮采购阶段。
        </div>
      )}

      {step === 'info' && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {STR_FIELD_DEFS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">{f.label}</span>
                <input
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="workbench-input mt-1 text-sm"
                />
              </label>
            ))}
            <label className="block">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">采购预算（元）</span>
              <input value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} inputMode="decimal" className="workbench-input mt-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">立项日期</span>
              <input
                type="date"
                value={form.initiationDate ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, initiationDate: e.target.value }))}
                className="workbench-input mt-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={annualBudget} onChange={(e) => setAnnualBudget(e.target.checked)} />
              年度预算内
            </label>
          </div>

          {/* 采购方式独立强调区 */}
          <div className="rounded-[14px] border p-3" style={{ borderColor: methodChanged ? 'var(--warning)' : 'color-mix(in oklch, var(--foreground) 12%, transparent)' }}>
            <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">采购方式（重点确认）</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="workbench-input mt-2 text-sm">
              {PROCUREMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {methodChanged && (
              <p className="mt-2 text-xs font-semibold text-[color:var(--warning)]">
                采购方式将由「{item.procurementMethod}」变更为「{method}」——第 {(item.currentRound ?? 1) + 1} 轮将按新方式生成阶段。
              </p>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">有修改的字段将更新到项目基本信息；未修改的保持原值。</p>
        </div>
      )}

      {step === 'start' && (
        <div className="mt-4 space-y-3">
          <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">从哪一步开始重启？</span>
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
                <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{o.hint}</span>
              </button>
            ))}
          </div>
          <div>
            <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
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
    </Modal>
  );
}
