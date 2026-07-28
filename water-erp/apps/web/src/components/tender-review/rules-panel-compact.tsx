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
import { fetchRules, extractRules, getExtractionTask, findActiveExtraction, deleteRule, updateRule, createRuleLegacy } from '@/lib/api/rules';
import type { ComplianceRule, RuleType, Severity } from '@/lib/types/tender-review';
import { RULE_TYPE_LABELS, SEVERITY_LABELS, SEVERITY_COLORS } from '@/lib/types/tender-review';
import { Modal } from '@/components/workbench';

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
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [prevRuleIds, setPrevRuleIds] = useState<Set<string>>(new Set());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadRules();
    // Check if there's an active extraction task for this KB and resume polling
    findActiveExtraction(knowledgeBaseId).then((task) => {
      if (task && task.status === 'running') {
        setExtracting(true);
        setExtractedCount(task.extractedCount ?? 0);
        setPrevRuleIds(new Set());
        startPolling(task.id, knowledgeBaseId);
      }
    });
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [knowledgeBaseId]);

  async function loadRules() {
    setLoading(true);
    try {
      const data = await fetchRules(knowledgeBaseId);
      setRules(data);
    } catch {
      toast.error('加载规则失败');
    } finally {
      setLoading(false);
    }
  }

  function startPolling(taskId: string, kbId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const [task, latestRules] = await Promise.all([
          getExtractionTask(taskId),
          fetchRules(kbId),
        ]);

        setRules(latestRules);
        if (task.extractedCount != null) {
          setExtractedCount(task.extractedCount);
        }

        if (task.status === 'completed') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setExtracting(false);
          setPrevRuleIds(new Set());

          const finalRules = await fetchRules(kbId);
          setRules(finalRules);
          toast.success(`规则提取完成，共提取 ${finalRules.length} 条规则`, { duration: 6000 });
        } else if (task.status === 'failed') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setExtracting(false);
          setPrevRuleIds(new Set());
          toast.error(task.error || '规则提取失败，请重试');
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
    toast.info('规则提取已在后台开始，提取期间可继续其他操作', { duration: 5000 });

    try {
      const { taskId } = await extractRules(knowledgeBaseId);

      startPolling(taskId, knowledgeBaseId);
    } catch (err) {
      console.error('Extract rules error:', err);
      toast.error('规则提取失败，请重试');
      setExtracting(false);
      setPrevRuleIds(new Set());
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此规则？')) return;
    try {
      await deleteRule(id);
      toast.success('已删除');
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('删除失败');
    }
  }

  async function handleSave() {
    if (!editingRule) return;
    setSaving(true);
    try {
      const el = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      const name = (el('edit-name') as HTMLInputElement)?.value ?? editingRule.name;
      const severity = (el('edit-severity') as HTMLSelectElement)?.value ?? editingRule.severity;
      const checkTarget = (el('edit-checkTarget') as HTMLInputElement)?.value ?? editingRule.checkTarget;
      const ruleType = (el('edit-ruleType') as HTMLSelectElement)?.value ?? editingRule.ruleType;

      let logicExpression = { ...editingRule.logicExpression } as Record<string, unknown>;
      if (editingRule.ruleType === 'numeric_compare') {
        logicExpression = {
          field: (el('edit-le-field') as HTMLInputElement)?.value ?? '',
          operator: (el('edit-le-operator') as HTMLSelectElement)?.value ?? '>=',
          threshold: Number((el('edit-le-threshold') as HTMLInputElement)?.value ?? 0),
          unit: (el('edit-le-unit') as HTMLSelectElement)?.value ?? 'cny',
        };
      } else if (editingRule.ruleType === 'existence_check') {
        const kw = (el('edit-le-keywords') as HTMLInputElement)?.value ?? '';
        logicExpression = {
          checkType: (el('edit-le-checkType') as HTMLSelectElement)?.value ?? 'keyword',
          keywords: kw ? kw.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) : [],
          sectionName: (el('edit-le-sectionName') as HTMLInputElement)?.value ?? '',
        };
      } else {
        logicExpression = {
          description: (el('edit-le-description') as HTMLTextAreaElement)?.value ?? '',
        };
      }

      const updated = await updateRule(editingRule.id, {
        name,
        severity: severity as Severity,
        checkTarget,
        ruleType: ruleType as RuleType,
        logicExpression,
      });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success('规则已更新');
      setEditingRule(null);
    } catch {
      toast.error('更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const el = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      const name = (el('create-name') as HTMLInputElement)?.value.trim();
      const severity = (el('create-severity') as HTMLSelectElement)?.value as Severity;
      const checkTarget = (el('create-checkTarget') as HTMLInputElement)?.value.trim();
      const ruleType = (el('create-ruleType') as HTMLSelectElement)?.value as RuleType;

      if (!name) { toast.error('请填写规则名称'); return; }

      let logicExpression: Record<string, unknown>;
      if (ruleType === 'numeric_compare') {
        logicExpression = {
          field: (el('create-le-field') as HTMLInputElement)?.value ?? '',
          operator: (el('create-le-operator') as HTMLSelectElement)?.value ?? '>=',
          threshold: Number((el('create-le-threshold') as HTMLInputElement)?.value ?? 0),
          unit: (el('create-le-unit') as HTMLSelectElement)?.value ?? 'cny',
        };
      } else if (ruleType === 'existence_check') {
        const kw = (el('create-le-keywords') as HTMLInputElement)?.value ?? '';
        logicExpression = {
          checkType: (el('create-le-checkType') as HTMLSelectElement)?.value ?? 'keyword',
          keywords: kw ? kw.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) : [],
          sectionName: (el('create-le-sectionName') as HTMLInputElement)?.value ?? '',
        };
      } else {
        logicExpression = {
          description: (el('create-le-description') as HTMLTextAreaElement)?.value ?? '',
        };
      }

      const created = await createRuleLegacy({
        knowledgeBaseId,
        source: '手动创建',
        name,
        ruleType,
        checkTarget,
        logicExpression,
        severity,
      });
      setRules((prev) => [created, ...prev]);
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
              onClick={() => setShowCreate(true)}
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
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[rule.severity]}`}>
                    {SEVERITY_LABELS[rule.severity]}
                  </span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {RULE_TYPE_LABELS[rule.ruleType]}
                  </span>
                </div>
                <div className="text-xs text-[var(--foreground)] truncate">
                  {rule.name}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => setEditingRule({ ...rule, logicExpression: { ...rule.logicExpression } })}
                    className="p-1 text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="p-1 text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] transition-colors"
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
          size="md"
          footer={
            <>
              <button className="neu-btn-soft" disabled={creating} onClick={() => setShowCreate(false)}>取消</button>
              <button className="neu-btn-primary" disabled={creating} onClick={handleCreate}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '创建'}
              </button>
            </>
          }
        >
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则名称 *</label>
            <input
              id="create-name"
              type="text"
              placeholder="例：投标保证金比例"
              className="workbench-input"
              readOnly={creating}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">严重程度</label>
              <select
                id="create-severity"
                defaultValue="warning"
                className="workbench-input"
              >
                <option value="critical">严重</option>
                <option value="warning">警告</option>
                <option value="info">提示</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">检查对象</label>
              <input
                id="create-checkTarget"
                type="text"
                placeholder="例：投标文件"
                className="workbench-input"
                readOnly={creating}
              />
            </div>
          </div>

          <CreateLogicFieldsCompact creating={creating} />
        </Modal>
      )}

      {/* Edit Modal */}
      {editingRule && (
        <Modal
          open
          onClose={() => !saving && setEditingRule(null)}
          title="编辑规则"
          size="md"
          footer={
            <>
              <button className="neu-btn-soft" disabled={saving} onClick={() => setEditingRule(null)}>取消</button>
              <button className="neu-btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '保存'}
              </button>
            </>
          }
        >
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则名称</label>
            <input
              id="edit-name"
              type="text"
              defaultValue={editingRule.name}
              className="workbench-input"
              readOnly={saving}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">严重程度</label>
              <select
                id="edit-severity"
                defaultValue={editingRule.severity}
                className="workbench-input"
              >
                <option value="critical">严重</option>
                <option value="warning">警告</option>
                <option value="info">提示</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">检查对象</label>
              <input
                id="edit-checkTarget"
                type="text"
                defaultValue={editingRule.checkTarget}
                className="workbench-input"
                readOnly={saving}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则类型</label>
            <select
              id="edit-ruleType"
              defaultValue={editingRule.ruleType}
              className="workbench-input"
            >
              <option value="numeric_compare">数值比较</option>
              <option value="existence_check">存在性检查</option>
              <option value="semantic">语义判定</option>
            </select>
          </div>

          {editingRule.ruleType === 'numeric_compare' && (
            <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
              <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（数值比较）</div>
              <div className="flex gap-2">
                <input id="edit-le-field" type="text" defaultValue={String((editingRule.logicExpression as any).field ?? '')}
                  className="workbench-input flex-1"
                  readOnly={saving} placeholder="字段" />
                <select id="edit-le-operator" defaultValue={String((editingRule.logicExpression as any).operator ?? '>=')}
                  className="workbench-input w-16"
                >
                  <option value=">=">≥</option>
                  <option value="<=">≤</option>
                  <option value=">">{'>'}</option>
                  <option value="<">{'<'}</option>
                  <option value="==">=</option>
                  <option value="!=">≠</option>
                </select>
                <input id="edit-le-threshold" type="number" defaultValue={Number((editingRule.logicExpression as any).threshold ?? 0)}
                  className="workbench-input flex-1"
                  readOnly={saving} placeholder="阈值" />
                <select id="edit-le-unit" defaultValue={String((editingRule.logicExpression as any).unit ?? 'cny')}
                  className="workbench-input w-16">
                  <option value="cny">元</option>
                  <option value="ten_thousand_cny">万元</option>
                  <option value="percent">%</option>
                  <option value="days">天</option>
                  <option value="none">无</option>
                </select>
              </div>
            </div>
          )}

          {editingRule.ruleType === 'existence_check' && (
            <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
              <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（存在性检查）</div>
              <input id="edit-le-keywords" type="text"
                defaultValue={Array.isArray((editingRule.logicExpression as any).keywords) ? ((editingRule.logicExpression as any).keywords as string[]).join(', ') : ''}
                className="workbench-input"
                readOnly={saving} placeholder="关键词（逗号分隔）" />
              <input id="edit-le-sectionName" type="text"
                defaultValue={String((editingRule.logicExpression as any).sectionName ?? '')}
                className="workbench-input"
                readOnly={saving} placeholder="章节名" />
            </div>
          )}

          {editingRule.ruleType === 'semantic' && (
            <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
              <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（语义判定）</div>
              <textarea id="edit-le-description" defaultValue={String((editingRule.logicExpression as any).description ?? '')}
                rows={2}
                className="neu-input text-sm"
                readOnly={saving} placeholder="检查描述" />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function CreateLogicFieldsCompact({ creating }: { creating: boolean }) {
  const [type, setType] = useState<RuleType>('semantic');

  return (
    <>
      <div>
        <label className="block text-xs text-[var(--muted-foreground)] mb-1">规则类型</label>
        <select
          id="create-ruleType"
          value={type}
          onChange={(e) => setType(e.target.value as RuleType)}
          className="workbench-input"
        >
          <option value="numeric_compare">数值比较</option>
          <option value="existence_check">存在性检查</option>
          <option value="semantic">语义判定</option>
        </select>
      </div>

      {type === 'numeric_compare' && (
        <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（数值比较）</div>
          <div className="flex gap-2">
            <input id="create-le-field" type="text" placeholder="字段"
              className="workbench-input flex-1"
              readOnly={creating} />
            <select id="create-le-operator" defaultValue=">="
              className="workbench-input w-16">
              <option value=">=">≥</option>
              <option value="<=">≤</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="==">=</option>
              <option value="!=">≠</option>
            </select>
            <input id="create-le-threshold" type="number" defaultValue={0}
              className="workbench-input flex-1"
              readOnly={creating} />
            <select id="create-le-unit" defaultValue="cny"
              className="workbench-input w-16">
              <option value="cny">元</option>
              <option value="ten_thousand_cny">万元</option>
              <option value="percent">%</option>
              <option value="days">天</option>
              <option value="none">无</option>
            </select>
          </div>
        </div>
      )}

      {type === 'existence_check' && (
        <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（存在性检查）</div>
          <input id="create-le-keywords" type="text" placeholder="关键词（逗号分隔）"
            className="workbench-input"
            readOnly={creating} />
          <input id="create-le-sectionName" type="text" placeholder="章节名"
            className="workbench-input"
            readOnly={creating} />
        </div>
      )}

      {type === 'semantic' && (
        <div className="space-y-2 p-3 rounded-[12px] bg-[var(--muted)]/40">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（语义判定）</div>
          <textarea id="create-le-description" rows={2}
            placeholder="检查描述"
            className="neu-input text-sm"
            readOnly={creating} />
        </div>
      )}
    </>
  );
}
