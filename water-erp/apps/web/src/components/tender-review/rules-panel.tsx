'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Loader2,
  Sparkles,
  Trash2,
  Filter,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchRules, extractRules, getExtractionTask, findActiveExtraction, deleteRule, updateRule, createRuleLegacy } from '@/lib/api/rules';
import { fetchKnowledgeBases } from '@/lib/api/knowledge';
import type { ComplianceRule, KnowledgeBase, RuleType, Severity } from '@/lib/types/tender-review';
import { RULE_TYPE_LABELS, SEVERITY_LABELS, SEVERITY_COLORS } from '@/lib/types/tender-review';

export default function RulesPanel() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [filterType, setFilterType] = useState<RuleType | ''>('');
  const [filterSeverity, setFilterSeverity] = useState<Severity | ''>('');
  const [editingRule, setEditingRule] = useState<ComplianceRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [prevRuleIds, setPrevRuleIds] = useState<Set<string>>(new Set());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    fetchKnowledgeBases().then(setKbs).catch(() => toast.error('加载知识库失败'));
  }, []);

  useEffect(() => {
    if (!selectedKb) { setRules([]); return; }
    setLoading(true);
    fetchRules(selectedKb)
      .then(setRules)
      .catch(() => toast.error('加载规则失败'))
      .finally(() => setLoading(false));
    // Resume polling if there's an active extraction for this KB
    findActiveExtraction(selectedKb).then((task) => {
      if (task && task.status === 'running') {
        setExtracting(true);
        setExtractedCount(task.extractedCount ?? 0);
        setPrevRuleIds(new Set());
        startPanelPolling(task.id, selectedKb);
      }
    });
  }, [selectedKb]);

  function startPanelPolling(taskId: string, kbId: string) {
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

  function handleExtract() {
    if (!selectedKb || extracting) return;
    setExtracting(true);
    setExtractedCount(0);
    setPrevRuleIds(new Set(rules.map(r => r.id)));
    toast.info('规则提取已在后台开始，提取期间可继续其他操作', { duration: 5000 });

    extractRules(selectedKb)
      .then(({ taskId }) => {
        pollIntervalRef.current = setInterval(async () => {
          try {
            const [task, latestRules] = await Promise.all([
              getExtractionTask(taskId),
              fetchRules(selectedKb),
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

              const finalRules = await fetchRules(selectedKb);
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
      })
      .catch((err) => {
        console.error('Extract rules error:', err);
        toast.error('规则提取失败，请重试');
        setExtracting(false);
        setPrevRuleIds(new Set());
      });
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
    if (!selectedKb) {
      toast.error('请先选择知识库');
      return;
    }
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
        knowledgeBaseId: selectedKb,
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

  const filtered = rules.filter((r) => {
    if (filterType && r.ruleType !== filterType) return false;
    if (filterSeverity && r.severity !== filterSeverity) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">审查规则</h3>
        <button
          onClick={handleExtract}
          disabled={!selectedKb || extracting}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium
            bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {extracting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          AI 提取规则
        </button>
      </div>

      {/* KB Selector */}
      <select
        value={selectedKb}
        onChange={(e) => setSelectedKb(e.target.value)}
        className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
          text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)] focus:ring-2 focus:ring-[rgba(96,139,239,0.1)] appearance-none"
      >
        <option value="">选择知识库...</option>
        {kbs.map((kb) => (
          <option key={kb.id} value={kb.id}>{kb.name}</option>
        ))}
      </select>

      {/* Filters + Add Rule */}
      {selectedKb && (
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <>
              <Filter className="h-4 w-4 text-[var(--muted-foreground)]" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as RuleType | '')}
                className="rounded-[10px] border border-white/45 bg-white/80 px-3 py-1.5 text-xs
                  text-[color:var(--foreground)] outline-none"
              >
                <option value="">全部类型</option>
                <option value="numeric_compare">数值比较</option>
                <option value="existence_check">存在性检查</option>
                <option value="semantic">语义判定</option>
              </select>
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value as Severity | '')}
                className="rounded-[10px] border border-white/45 bg-white/80 px-3 py-1.5 text-xs
                  text-[color:var(--foreground)] outline-none"
              >
                <option value="">全部级别</option>
                <option value="critical">严重</option>
                <option value="warning">警告</option>
                <option value="info">提示</option>
              </select>
              <span className="text-xs text-[var(--muted-foreground)]">
                {filtered.length}/{rules.length} 条
              </span>
            </>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-1.5 rounded-[10px] border border-[var(--accent)]/30
              bg-[var(--accent)]/5 px-3 py-1.5 text-xs font-medium text-[var(--accent)]
              hover:bg-[var(--accent)]/10 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            新增规则
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !extracting && selectedKb && filtered.length === 0 && (
        <div className="text-center py-12 text-[var(--muted-foreground)]">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>暂无规则，点击"AI 提取规则"自动生成</p>
        </div>
      )}

      {/* Extraction progress bar */}
      {extracting && (
        <div className="rounded-[14px] bg-[var(--accent)]/8 border border-[var(--accent)]/15 px-4 py-3 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-[var(--foreground)]">AI 规则提取中</span>
              <span className="text-[11px] text-[var(--accent)] font-medium">{extractedCount > 0 ? `已提取 ${extractedCount} 条规则` : '正在处理...'}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--accent)]/10 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-[var(--accent)] animate-[progress-indeterminate_2s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((rule) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`rounded-[16px] p-4 transition-colors ${
                extracting && prevRuleIds && !prevRuleIds.has(rule.id)
                  ? 'bg-[var(--accent)]/6 ring-1 ring-[var(--accent)]/15'
                  : 'panel-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[rule.severity]}`}>
                      {SEVERITY_LABELS[rule.severity]}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-[var(--muted-foreground)]">
                      {RULE_TYPE_LABELS[rule.ruleType]}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {rule.checkTarget}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-[var(--foreground)]">
                    {rule.name}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    来源：{rule.source}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingRule({ ...rule, logicExpression: { ...rule.logicExpression } })}
                    className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Modal - rendered via Portal */}
      {showCreate && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-md p-4"
            onClick={() => !creating && setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[24px] w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[color:var(--foreground)]">新增规则</h3>
                  <button onClick={() => !creating && setShowCreate(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">规则名称 *</label>
                  <input
                    id="create-name"
                    type="text"
                    placeholder="例：投标保证金比例"
                    className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                      text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                    readOnly={creating}
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">严重程度</label>
                    <select
                      id="create-severity"
                      defaultValue="warning"
                      className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                        text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                    >
                      <option value="critical">严重</option>
                      <option value="warning">警告</option>
                      <option value="info">提示</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">检查对象</label>
                    <input
                      id="create-checkTarget"
                      type="text"
                      placeholder="例：投标文件"
                      className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                        text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                      readOnly={creating}
                    />
                  </div>
                </div>

                <CreateLogicFields creating={creating} />

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="rounded-[14px] px-5 py-2.5 text-sm font-medium bg-[rgba(96,139,239,0.9)] text-white hover:bg-[rgba(96,139,239,1)] transition-colors disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '创建'}
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    disabled={creating}
                    className="rounded-[14px] px-5 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Modal - rendered via Portal to avoid transform issues */}
      {editingRule && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-md p-4"
            onClick={() => !saving && setEditingRule(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[24px] w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[color:var(--foreground)]">编辑规则</h3>
                  <button onClick={() => !saving && setEditingRule(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">规则名称</label>
                  <input
                    id="edit-name"
                    type="text"
                    defaultValue={editingRule.name}
                    className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                      text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                    readOnly={saving}
                  />
                </div>

                {/* Severity + CheckTarget row */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">严重程度</label>
                    <select
                      id="edit-severity"
                      defaultValue={editingRule.severity}
                      className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                        text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                    >
                      <option value="critical">严重</option>
                      <option value="warning">警告</option>
                      <option value="info">提示</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">检查对象</label>
                    <input
                      id="edit-checkTarget"
                      type="text"
                      defaultValue={editingRule.checkTarget}
                      className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                        text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                      readOnly={saving}
                    />
                  </div>
                </div>

                {/* Rule Type */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">规则类型</label>
                  <select
                    id="edit-ruleType"
                    defaultValue={editingRule.ruleType}
                    className="w-full rounded-[12px] border border-white/45 bg-white/80 px-4 py-2.5 text-sm
                      text-[color:var(--foreground)] outline-none focus:border-[rgba(96,139,239,0.5)]"
                  >
                    <option value="numeric_compare">数值比较</option>
                    <option value="existence_check">存在性检查</option>
                    <option value="semantic">语义判定</option>
                  </select>
                </div>

                {/* Logic Expression - numeric_compare */}
                {editingRule.ruleType === 'numeric_compare' && (
                  <div className="space-y-3 p-4 rounded-[14px] bg-white/50 border border-white/35">
                    <div className="text-xs font-medium text-[var(--muted-foreground)]">逻辑表达式（数值比较）</div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-[var(--muted-foreground)] mb-1">字段</label>
                        <input id="edit-le-field" type="text" defaultValue={String((editingRule.logicExpression as any).field ?? '')}
                          className="w-full rounded-[10px] border border-white/45 bg-white/80 px-3 py-2 text-sm text-[color:var(--foreground)] outline-none"
                          readOnly={saving} />
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-[var(--muted-foreground)] mb-1">运算符</label>
                        <select id="edit-le-operator" defaultValue={String((editingRule.logicExpression as any).operator ?? '>=')}
                          className="w-full rounded-[10px] border border-white/45 bg-white/80 px-3 py-2 text-sm text-[color:var(--foreground)] outline-none">
                          <option value=">=">{'≥'}</option>
                          <option value="<=">{'≤'}</option>
                          <option value=">">{'>'}</option>
                          <option value="<">{'<'}</option>
                          <option value="==">{'='}</option>
                          <option value="!=">{'≠'}</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-[var(--muted-foreground)] mb-1">阈值</label>
                        <input id="edit-le-threshold" type="number" defaultValue={Number((editingRule.logicExpression as any).threshold ?? 0)}
                          className="w-full rounded-[10px] border border-white/45 bg-white/80 px-3 py-2 text-sm text-[color:var(--foreground)] outline-none"
                          readOnly={saving} />
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-[var(--muted-foreground)] mb-1">单位</label>
                        <select id="edit-le-unit" defaultValue={String((editingRule.logicExpression as any).unit ?? 'cny')}
                          className="w-full rounded-[10px] border border-white/45 bg-white/80 px-3 py-2 text-sm text-[color:var(--foreground)] outline-none">
                          <option value="cny">元</option>
                          <option value="ten_thousand_cny">万元</option>
                          <option value="days">天</option>
                          <option value="months">月</option>
                          <option value="years">年</option>
                          <option value="percent">%</option>
                          <option value="ratio">比率</option>
                          <option value="count">个/次/人</option>
                          <option value="copies">份</option>
                          <option value="points">分</option>
                          <option value="hours">小时</option>
                          <option value="none">无单位</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Logic Expression - existence_check */}
                {editingRule.ruleType === 'existence_check' && (
                  <div className="space-y-3 p-4 rounded-[14px] bg-gray-50 border border-gray-100">
                    <div className="text-xs font-medium text-gray-500">逻辑表达式（存在性检查）</div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">检查类型</label>
                      <select id="edit-le-checkType" defaultValue={String((editingRule.logicExpression as any).checkType ?? 'keyword')}
                        className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none">
                        <option value="keyword">关键词</option>
                        <option value="section">章节</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">关键词（逗号分隔）</label>
                      <input id="edit-le-keywords" type="text"
                        defaultValue={Array.isArray((editingRule.logicExpression as any).keywords) ? ((editingRule.logicExpression as any).keywords as string[]).join(', ') : ''}
                        className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
                        readOnly={saving} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">章节名</label>
                      <input id="edit-le-sectionName" type="text"
                        defaultValue={String((editingRule.logicExpression as any).sectionName ?? '')}
                        className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
                        readOnly={saving} />
                    </div>
                  </div>
                )}

                {/* Logic Expression - semantic */}
                {editingRule.ruleType === 'semantic' && (
                  <div className="space-y-3 p-4 rounded-[14px] bg-gray-50 border border-gray-100">
                    <div className="text-xs font-medium text-gray-500">逻辑表达式（语义判定）</div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">检查描述</label>
                      <textarea id="edit-le-description" defaultValue={String((editingRule.logicExpression as any).description ?? '')}
                        rows={3}
                        className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none resize-none"
                        readOnly={saving} />
                    </div>
                  </div>
                )}

                {/* Source (read-only) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">来源</label>
                  <div className="text-sm text-gray-500 rounded-[12px] border border-gray-100 bg-gray-50 px-4 py-2.5">
                    {editingRule.source}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin inline" /> : '保存'}
                  </button>
                  <button
                    onClick={() => setEditingRule(null)}
                    disabled={saving}
                    className="rounded-xl px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function CreateLogicFields({ creating }: { creating: boolean }) {
  const [type, setType] = useState<RuleType>('semantic');

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">规则类型</label>
        <select
          id="create-ruleType"
          value={type}
          onChange={(e) => setType(e.target.value as RuleType)}
          className="w-full rounded-[12px] border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm
            text-gray-900 outline-none focus:border-blue-400"
        >
          <option value="numeric_compare">数值比较</option>
          <option value="existence_check">存在性检查</option>
          <option value="semantic">语义判定</option>
        </select>
      </div>

      {type === 'numeric_compare' && (
        <div className="space-y-3 p-4 rounded-[14px] bg-gray-50 border border-gray-100">
          <div className="text-xs font-medium text-gray-500">逻辑表达式（数值比较）</div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">字段</label>
              <input id="create-le-field" type="text" placeholder="例：投标保证金"
                className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
                readOnly={creating} />
            </div>
            <div className="w-24">
              <label className="block text-xs text-gray-400 mb-1">运算符</label>
              <select id="create-le-operator" defaultValue=">="
                className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none">
                <option value=">=">{'≥'}</option>
                <option value="<=">{'≤'}</option>
                <option value=">">{'>'}</option>
                <option value="<">{'<'}</option>
                <option value="==">{'='}</option>
                <option value="!=">{'≠'}</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">阈值</label>
              <input id="create-le-threshold" type="number" defaultValue={0}
                className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
                readOnly={creating} />
            </div>
            <div className="w-24">
              <label className="block text-xs text-gray-400 mb-1">单位</label>
              <select id="create-le-unit" defaultValue="cny"
                className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none">
                <option value="cny">元</option>
                <option value="ten_thousand_cny">万元</option>
                <option value="days">天</option>
                <option value="months">月</option>
                <option value="years">年</option>
                <option value="percent">%</option>
                <option value="ratio">比率</option>
                <option value="count">个/次/人</option>
                <option value="copies">份</option>
                <option value="points">分</option>
                <option value="hours">小时</option>
                <option value="none">无单位</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {type === 'existence_check' && (
        <div className="space-y-3 p-4 rounded-[14px] bg-gray-50 border border-gray-100">
          <div className="text-xs font-medium text-gray-500">逻辑表达式（存在性检查）</div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">检查类型</label>
            <select id="create-le-checkType" defaultValue="keyword"
              className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none">
              <option value="keyword">关键词</option>
              <option value="section">章节</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">关键词（逗号分隔）</label>
            <input id="create-le-keywords" type="text" placeholder="例：投标函, 报价单"
              className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
              readOnly={creating} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">章节名</label>
            <input id="create-le-sectionName" type="text" placeholder="例：评标办法"
              className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
              readOnly={creating} />
          </div>
        </div>
      )}

      {type === 'semantic' && (
        <div className="space-y-3 p-4 rounded-[14px] bg-gray-50 border border-gray-100">
          <div className="text-xs font-medium text-gray-500">逻辑表达式（语义判定）</div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">检查描述</label>
            <textarea id="create-le-description" rows={3}
              placeholder="例：投标文件应包含完整的施工方案且技术参数不得低于招标文件要求"
              className="w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none resize-none"
              readOnly={creating} />
          </div>
        </div>
      )}
    </>
  );
}
