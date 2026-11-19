'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Loader2,
  Trash2,
  Pencil,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@water-erp/client';
import {
  RULE_UNITS,
  RULE_OPERATORS,
  RULE_SEVERITIES,
  RULE_CHECK_TYPES,
} from '@water-erp/shared';
import { fetchRules, extractRules, getExtractionTask, findActiveExtraction, deleteRule, updateRule, createRuleLegacy } from '@/lib/api/rules';
import type { ComplianceRule, RuleType, Severity } from '@/lib/types/tender-review';
import { RULE_TYPE_LABELS, SEVERITY_LABELS, SEVERITY_COLORS } from '@/lib/types/tender-review';
import { Modal } from '@/components/workbench';
import { useConfirm } from '@/components/workbench/use-confirm';

/** 规则表单枚举域（2026-11-19 审查 #13）：自 @water-erp/shared 单源——
 *  抽取提示词/后端归一/本表单三处同源，加值只改 shared 一处 */
const OPERATOR_LABELS: Record<string, string> = {
  '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=', '!=': '≠',
};
const CHECK_TYPE_LABELS: Record<string, string> = {
  keyword: '按关键词', section: '按章节',
};

/** 规则编辑草稿（2026-11-19 审查 #1/#3/#6/#12/#14 收口）：编辑/新建全受控——
 *  旧实现 uncontrolled defaultValue + getElementById 收割，导致类型切换面板
 *  不联动/往返重挂丢输入/隐藏字段被抹/枚举漂移值回显首项静默改写四族缺陷。
 *  logic 保留全部类型字段（threshold 为文本，保存时校验），切类型不丢已输入。 */
interface RuleDraft {
  name: string;
  severity: string;
  ruleType: RuleType;
  logic: {
    field?: string;
    operator?: string;
    threshold?: string;
    unit?: string;
    checkType?: string;
    keywords?: string;
    sectionName?: string;
    description?: string;
  };
}

function draftFromRule(rule: ComplianceRule): RuleDraft {
  const logic = (rule.logicExpression ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v));
  return {
    name: rule.name,
    severity: rule.severity,
    ruleType: rule.ruleType,
    logic: {
      field: str(logic.field),
      operator: str(logic.operator, '>='),
      threshold: logic.threshold == null ? '' : String(logic.threshold),
      unit: str(logic.unit, 'cny'),
      checkType: str(logic.checkType, 'keyword'),
      keywords: Array.isArray(logic.keywords) ? (logic.keywords as string[]).join(', ') : '',
      sectionName: str(logic.sectionName),
      description: str(logic.description),
    },
  };
}

function emptyDraft(): RuleDraft {
  return {
    name: '',
    severity: 'warning',
    ruleType: 'semantic',
    logic: {
      field: '',
      operator: '>=',
      threshold: '',
      unit: 'cny',
      checkType: 'keyword',
      keywords: '',
      sectionName: '',
      description: '',
    },
  };
}

/** 保存前逻辑收口（审查 #1/#12）：existence 双侧字段都持久化——executor 是
 *  keywords→sectionName 回退链（空 keywords 回退 sectionName），抹掉任一侧
 *  =静默废掉该规则；numeric 阈值必填数字——旧收割 Number('')===0 把清空的
 *  阈值静默存成 0（「≥0」恒过=废掉检查）。返回 null=校验失败（已 toast）。 */
function buildLogicForSave(draft: RuleDraft): Record<string, unknown> | null {
  const l = draft.logic;
  if (draft.ruleType === 'numeric_compare') {
    const raw = (l.threshold ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      toast.error('请填写数值阈值');
      return null;
    }
    return {
      field: (l.field ?? '').trim(),
      operator: l.operator ?? '>=',
      threshold: n,
      unit: l.unit ?? 'cny',
    };
  }
  if (draft.ruleType === 'existence_check') {
    const keywords = (l.keywords ?? '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      checkType: l.checkType ?? 'keyword',
      keywords,
      sectionName: (l.sectionName ?? '').trim(),
    };
  }
  return { description: (l.description ?? '').trim() };
}

/** 规则表单字段（编辑/新建共用，审查 #14 去重）：全受控，切换类型/检查型不丢
 *  已输入（state 驻留父级，面板卸载重挂不回退）；所有枚举 select 对存量漂移值
 *  「追加为选项原样保留」（#6）——value 不在 options 内时浏览器回显首项，用户
 *  不碰保存也会被静默改写（如 severity 漂移值被强转 critical=升权重）。 */
function RuleFormFields({ draft, onChange, disabled, source }: {
  draft: RuleDraft;
  onChange: (next: RuleDraft) => void;
  disabled?: boolean;
  source?: string;
}) {
  const patch = (p: Partial<RuleDraft>) => onChange({ ...draft, ...p });
  const patchLogic = (p: Partial<RuleDraft['logic']>) =>
    onChange({ ...draft, logic: { ...draft.logic, ...p } });
  const opts = (values: readonly string[], current: string): string[] =>
    values.includes(current) ? [...values] : [current, ...values];
  const l = draft.logic;
  const isCreate = source === undefined;

  return (
    <>
      {/* 来源：块级多行折行展示（2026-11-19 三轮，用户裁定）——条款原文可能是整段
          （如办法第一条全文），旧单行 flex+shrink-0 会横向溢出靠滚动条看；现自然
          折行、文件名以（）随文尾，break-words 兜底超长无空格串，title 悬浮原文 */}
      {source !== undefined && (
        (() => {
          const sep = source.lastIndexOf('（');
          const clause = sep > 0 && source.endsWith('）') ? source.slice(0, sep) : source;
          const file = sep > 0 && source.endsWith('）') ? source.slice(sep + 1, -1) : '';
          return (
            <div className="break-words text-xs leading-relaxed text-[var(--muted-foreground)]" title={source}>
              来源：<span className="text-[var(--foreground)]">{clause}</span>
              {file && <span>（{file}）</span>}
            </div>
          );
        })()
      )}

      {/* 属性区：名称通栏 + 两枚举一行（检查对象已砍 2026-11-19：登记性元数据
          零消费——执行/列表/报告三面均不读；grid 由三列收两列） */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="col-span-3">
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则名称{isCreate ? ' *' : ''}</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={isCreate ? '例：投标保证金比例' : undefined}
            className="workbench-input w-full"
            readOnly={disabled}
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">严重程度</label>
          <select
            value={draft.severity}
            onChange={(e) => patch({ severity: e.target.value })}
            className="workbench-input w-full"
          >
            {opts(RULE_SEVERITIES, draft.severity).map((v) => (
              <option key={v} value={v}>{(SEVERITY_LABELS as Record<string, string>)[v] ?? v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则类型</label>
          <select
            value={draft.ruleType}
            onChange={(e) => patch({ ruleType: e.target.value as RuleType })}
            className="workbench-input w-full"
          >
            <option value="numeric_compare">数值比较</option>
            <option value="existence_check">存在性检查</option>
            <option value="semantic">语义判定</option>
          </select>
        </div>
      </div>

      {/* 检查条件区：标题 + muted 类型后缀（基线对齐，替代徽章——弹窗内小徽章
          与表单黑字风格不搭），内部 existence 一行两列压缩高度 */}
      <div className="space-y-2.5 rounded-[12px] bg-[var(--muted)]/40 p-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-[var(--foreground)]">检查条件</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            · {RULE_TYPE_LABELS[draft.ruleType] ?? draft.ruleType}
          </span>
        </div>

        {draft.ruleType === 'numeric_compare' && (
          <div className="flex gap-2">
            <input type="text" value={l.field ?? ''} onChange={(e) => patchLogic({ field: e.target.value })}
              className="workbench-input flex-1" readOnly={disabled} placeholder="字段名，如 budgetAmount" />
            <select value={l.operator ?? '>='} onChange={(e) => patchLogic({ operator: e.target.value })}
              className="workbench-input w-16">
              {opts(RULE_OPERATORS, l.operator ?? '>=').map((op) => (
                <option key={op} value={op}>{OPERATOR_LABELS[op] ?? op}</option>
              ))}
            </select>
            <input type="text" value={l.threshold ?? ''} onChange={(e) => patchLogic({ threshold: e.target.value })}
              className="workbench-input flex-1" readOnly={disabled} placeholder="阈值" inputMode="decimal" />
            <select value={l.unit ?? 'cny'} onChange={(e) => patchLogic({ unit: e.target.value })}
              className="workbench-input w-20">
              {opts(RULE_UNITS.map((u) => u.value), l.unit ?? 'cny').map((v) => (
                <option key={v} value={v}>{RULE_UNITS.find((u) => u.value === v)?.label ?? v}</option>
              ))}
            </select>
          </div>
        )}

        {draft.ruleType === 'existence_check' && (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">检查方式</label>
              <select
                value={l.checkType ?? 'keyword'}
                onChange={(e) => patchLogic({ checkType: e.target.value })}
                className="workbench-input w-full"
              >
                {opts(RULE_CHECK_TYPES, l.checkType ?? 'keyword').map((v) => (
                  <option key={v} value={v}>{CHECK_TYPE_LABELS[v] ?? v}</option>
                ))}
              </select>
            </div>
            {/* 双侧都驻留 draft（审查 #1）：executor 对 keywords→sectionName 是回退链，
                只渲染一侧+收割抹掉另一侧=静默废掉规则；生效侧由检查方式决定。
                检查方式+关键词（主用对）一行，章节名次级通栏 */}
            <div className="col-span-2">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">关键词</label>
              <input type="text" value={l.keywords ?? ''} onChange={(e) => patchLogic({ keywords: e.target.value })}
                className="workbench-input w-full" readOnly={disabled} placeholder="多个用逗号分隔" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">章节名</label>
              <input type="text" value={l.sectionName ?? ''} onChange={(e) => patchLogic({ sectionName: e.target.value })}
                className="workbench-input w-full" readOnly={disabled} placeholder="按章节检查时使用" />
            </div>
          </div>
        )}

        {draft.ruleType === 'semantic' && (
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">检查描述</label>
            <textarea value={l.description ?? ''} onChange={(e) => patchLogic({ description: e.target.value })}
              rows={2} className="neu-input w-full text-sm" readOnly={disabled} placeholder="描述要检查的合规要求" />
          </div>
        )}
      </div>
    </>
  );
}

interface RulesPanelCompactProps {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  /** 是否可维护（创建者/admin）。false=只读，隐藏 提取/增删改。默认 true 兼容旧调用。 */
  canEdit?: boolean;
}

export default function RulesPanelCompact({ knowledgeBaseId, knowledgeBaseName, canEdit = true }: RulesPanelCompactProps) {
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [editingRule, setEditingRule] = useState<ComplianceRule | null>(null);
  const [editingDraft, setEditingDraft] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<RuleDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  /** 「新」徽章基线（2026-11-19 审查 #10 修正）：=任务开始（createdAt）前已存在的
   *  规则 id 集——点击提取/刷新接管/409 接管三条路同口径种子，不在基线内的打
   *  「新」；完成后保留（看清本轮加了什么），下次提取/换库/手动新增入基线时消解 */
  const [prevRuleIds, setPrevRuleIds] = useState<Set<string>>(new Set());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /** 轮询纪元（2026-11-19 审查 #9）：切库/接管/终态都会 ++——在飞 tick 与迟到
   *  响应对不上纪元即丢弃，防旧库轮询清掉新库轮询、旧数据回写新态 */
  const pollEpochRef = useRef(0);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 挂载/换库：载入 → 探询接管（基线=任务开始前已存在的规则，而非空集）
      const data = await loadRules();
      if (cancelled) return;
      const task = await findActiveExtraction(knowledgeBaseId).catch(() => null);
      if (cancelled) return;
      if (task && task.status === 'running') {
        setExtracting(true);
        setExtractedCount(task.extractedCount ?? 0);
        seedBaseline(data, task.createdAt);
        startPolling(task.id, knowledgeBaseId);
      } else {
        setExtracting(false); // 清旧库/旧任务残留态
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
      setExtracting(false);
    };
  }, [knowledgeBaseId]);

  async function loadRules(): Promise<ComplianceRule[]> {
    // 换库/重挂载：清新增标记基线
    setPrevRuleIds(new Set());
    setLoading(true);
    try {
      const data = await fetchRules(knowledgeBaseId);
      setRules(data);
      return data;
    } catch {
      toast.error('加载规则失败');
      return [];
    } finally {
      setLoading(false);
    }
  }

  /** 基线种子：createdAt ≤ 任务启动时刻的规则视为「已存在」；无 createdAt 不种子 */
  function seedBaseline(currentRules: ComplianceRule[], taskCreatedAt?: string) {
    if (!taskCreatedAt) return;
    const cut = new Date(taskCreatedAt).getTime();
    setPrevRuleIds(
      new Set(
        currentRules
          .filter((r) => new Date(r.createdAt).getTime() <= cut)
          .map((r) => r.id),
      ),
    );
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollEpochRef.current++; // 作废在飞 tick 与迟到响应（#9）
  }

  function startPolling(taskId: string, kbId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    const epoch = ++pollEpochRef.current;
    pollIntervalRef.current = setInterval(async () => {
      if (pollEpochRef.current !== epoch) return;
      try {
        const [task, latestRules] = await Promise.all([
          getExtractionTask(taskId),
          fetchRules(kbId),
        ]);
        if (pollEpochRef.current !== epoch) return; // 响应跨越切库/重启轮询：丢弃

        setRules(latestRules);
        if (task.extractedCount != null) {
          setExtractedCount(task.extractedCount);
        }

        if (task.status === 'completed' || task.status === 'failed') {
          // 终态：注销纪元（作废同刻在飞 tick）再收尾
          pollEpochRef.current++;
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setExtracting(false);

          if (task.status === 'completed') {
            // prevRuleIds 保留：完成后「新」标记继续标出本轮新增
            const finalRules = await fetchRules(kbId).catch(() => null);
            // 期间无人重启过轮询（纪元仍是本任务终态注销后的值）才落最终列表
            if (finalRules && pollEpochRef.current === epoch + 1) {
              setRules(finalRules);
            }
            toast.success(
              `规则提取完成，本次新增 ${task.extractedCount ?? 0} 条，库内共 ${finalRules?.length ?? latestRules.length} 条`,
              { duration: 6000 },
            );
          } else {
            toast.error(task.error || '规则提取失败，请重试');
          }
        }
      } catch (err) {
        console.error('Poll extraction task error:', err);
      }
    }, 3000);
  }

  async function handleExtract() {
    if (extracting) return;
    setExtracting(true);
    setExtractedCount(0);
    setPrevRuleIds(new Set(rules.map(r => r.id)));

    try {
      const { taskId } = await extractRules(knowledgeBaseId);
      toast.info('规则提取已在后台开始，提取期间可继续其他操作', { duration: 5000 });
      startPolling(taskId, knowledgeBaseId);
    } catch (err) {
      console.error('Extract rules error:', err);
      // 仅 409（并发闸）才接管（审查 #2）：探询端点无属主校验，无差别接管会把
      // 403/500/网络错误伪装成「已接管进度」，真实错误只剩 console
      if (err instanceof ApiError && err.status === 409) {
        // 探询区分「确认无任务」与「查询失败」（复审 #4/#5）：失败不再伪装成
        // 「刚刚完成」——那会在任务仍在跑时给出虚假成功提示
        let active: Awaited<ReturnType<typeof findActiveExtraction>> = null;
        let probeFailed = false;
        try {
          active = await findActiveExtraction(knowledgeBaseId);
        } catch {
          probeFailed = true;
        }
        if (active && active.status === 'running') {
          seedBaseline(rules, active.createdAt);
          toast.info('该知识库正在提取规则，已显示当前进度');
          startPolling(active.id, knowledgeBaseId);
          return;
        }
        if (probeFailed) {
          toast.error('该知识库可能正在提取规则，但状态查询失败，请稍后刷新查看');
          setExtracting(false);
          setPrevRuleIds(new Set());
          return;
        }
        // 探询确认无 running：任务恰在 409 与探询之间完成——刷新列表让成果
        // 可见，不弹过时的「请等待完成」
        const latest = await fetchRules(knowledgeBaseId).catch(() => null);
        if (latest) setRules(latest);
        toast.info('提取刚刚完成，已刷新规则列表');
        setExtracting(false);
        setPrevRuleIds(new Set());
        return;
      }
      toast.error(err instanceof Error && err.message ? err.message : '规则提取失败，请重试');
      setExtracting(false);
      setPrevRuleIds(new Set());
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: '确定删除此规则？', danger: true }))) return;
    try {
      await deleteRule(id);
      toast.success('已删除');
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('删除失败');
    }
  }

  async function handleSave() {
    if (!editingRule || !editingDraft) return;
    const name = editingDraft.name.trim();
    if (!name) { toast.error('请填写规则名称'); return; }
    const logicExpression = buildLogicForSave(editingDraft);
    if (!logicExpression) return;
    setSaving(true);
    try {
      const updated = await updateRule(editingRule.id, {
        name,
        severity: editingDraft.severity as Severity,
        ruleType: editingDraft.ruleType,
        logicExpression,
      });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success('规则已更新');
      setEditingRule(null);
      setEditingDraft(null);
    } catch {
      toast.error('更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    const name = createDraft.name.trim();
    if (!name) { toast.error('请填写规则名称'); return; }
    const logicExpression = buildLogicForSave(createDraft);
    if (!logicExpression) return;
    setCreating(true);
    try {
      const created = await createRuleLegacy({
        knowledgeBaseId,
        source: '手动创建',
        name,
        ruleType: createDraft.ruleType,
        logicExpression,
        severity: createDraft.severity as Severity,
      });
      setRules((prev) => [created, ...prev]);
      // 手动新增不戴「新」徽章（审查 #10）：入基线
      setPrevRuleIds((prev) => new Set(prev).add(created.id));
      toast.success('规则已创建');
      setShowCreate(false);
    } catch {
      toast.error('创建失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-xs text-[var(--muted-foreground)]">
          {rules.length} 条规则
        </span>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
                bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors
                disabled:opacity-40"
            >
              <Loader2 className={`h-3 w-3 ${extracting ? 'animate-spin' : ''}`} />
              {extracting ? 'AI 提取中' : 'AI 提取'}
            </button>
            <button
              onClick={() => {
                setCreateDraft(emptyDraft()); // 每次打开重置草稿
                setShowCreate(true);
              }}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
                border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--accent)]
                hover:bg-[var(--accent)]/10 transition-colors"
            >
              <Plus className="h-3 w-3" />
              新增
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-[var(--muted-foreground)]">只读（他人共享）</span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8 shrink-0">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !extracting && rules.length === 0 && (
        <div className="text-center py-8 text-[var(--muted-foreground)] text-xs shrink-0">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>暂无规则</p>
          {canEdit && <p className="mt-1">点击"AI 提取"自动生成</p>}
        </div>
      )}

      {/* Extraction progress bar */}
      {extracting && (
        <div className="shrink-0 rounded-[10px] bg-[var(--accent)]/8 border border-[var(--accent)]/15 px-3 py-2.5 flex items-center gap-2.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-[var(--foreground)]">AI 规则提取中</span>
              <span className="text-[10px] text-[var(--accent)] font-medium">{extractedCount > 0 ? `${extractedCount} 条` : '处理中...'}</span>
            </div>
            <div className="h-1 rounded-full bg-[var(--accent)]/10 overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)] animate-[progress-indeterminate_2s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      {!loading && rules.length > 0 && (
        <div className="space-y-1.5 flex-1 overflow-y-auto pr-1">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-2 p-2 rounded-[10px] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[rule.severity] ?? ''}`}>
                    {SEVERITY_LABELS[rule.severity] ?? rule.severity}
                  </span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType}
                  </span>
                  {prevRuleIds.size > 0 && !prevRuleIds.has(rule.id) && (
                    <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1 py-px text-[9px] font-bold text-[var(--accent)]">
                      新
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--foreground)] truncate">
                  {rule.name}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setEditingRule(rule);
                      setEditingDraft(draftFromRule(rule));
                    }}
                    className="p-1 text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)] transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <Modal
          open
          onClose={() => !creating && setShowCreate(false)}
          title="新增规则"
          size="lg"
          footer={
            <>
              <button className="neu-btn-soft" disabled={creating} onClick={() => setShowCreate(false)}>取消</button>
              <button className="neu-btn-primary" disabled={creating} onClick={handleCreate}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '创建'}
              </button>
            </>
          }
        >
          <RuleFormFields draft={createDraft} onChange={setCreateDraft} disabled={creating} />
        </Modal>
      )}

      {/* Edit Modal */}
      {editingRule && editingDraft && (
        <Modal
          open
          onClose={() => !saving && setEditingRule(null)}
          title="编辑规则"
          size="lg"
          footer={
            <>
              <button className="neu-btn-soft" disabled={saving} onClick={() => setEditingRule(null)}>取消</button>
              <button className="neu-btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '保存'}
              </button>
            </>
          }
        >
          <RuleFormFields draft={editingDraft} onChange={setEditingDraft} disabled={saving} source={editingRule.source} />
        </Modal>
      )}
      {dialog}
    </div>
  );
}
