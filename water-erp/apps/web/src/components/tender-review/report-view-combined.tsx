'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  CircleSlash,
  ChevronDown,
  Check,
  X,
  Search,
} from 'lucide-react';
import type { ReviewTask, Issue, ReviewReport } from '@/lib/types/tender-review';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '@/lib/types/tender-review';
import { resolveIssue } from '@/lib/api/review';
import { useTenderReview } from './tender-review-context';
import OriginalTextCompare from './original-text-compare';
import SuggestionEditor from './suggestion-editor';
// flattenReport/导出处理器已迁 report-context-bar（2026-11-18 头部升格，独立页/编写弹窗两处共用）
import ReportContextBar, { flattenReport } from './report-context-bar';

type FilterKey = 'all' | 'critical' | 'warning' | 'info' | 'dataMissing' | 'passed' | 'skipped';

interface IssueGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  dotColor: string;
  issues: Array<{ issue: Issue; originalIndex: number }>;
}

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string; icon: React.ReactNode; colorClass: string }> = [
  { key: 'all', label: '全部', icon: null, colorClass: '' },
  { key: 'critical', label: '严重', icon: <XCircle className="h-4 w-4" />, colorClass: 'text-[var(--danger)]' },
  { key: 'warning', label: '警告', icon: <AlertTriangle className="h-4 w-4" />, colorClass: 'text-[var(--warning)]' },
  { key: 'info', label: '提示', icon: <Circle className="h-4 w-4" />, colorClass: 'text-[var(--accent)]' },
  { key: 'dataMissing', label: '忽略', icon: <Circle className="h-4 w-4" />, colorClass: 'text-[var(--muted-foreground)]' },
  { key: 'passed', label: '通过', icon: <CheckCircle2 className="h-4 w-4" />, colorClass: 'text-[var(--success)]' },
  { key: 'skipped', label: '跳过', icon: <CircleSlash className="h-4 w-4" />, colorClass: 'text-[var(--muted-foreground)]/60' },
];

interface ReportViewCombinedProps {
  task: ReviewTask;
  /** 返程回调（2026-11-18 起独立审查页的返回升格 hero，不传时上下文条不渲染返回钮） */
  onBack?: () => void;
  /** 隐藏「返回」按钮（2026-11-12 用户裁定）：编写弹窗审查流已有右上角 ✕ 关闭，返回冗余。 */
  hideBack?: boolean;
  /** 隐藏整条详情头（2026-11-18）：独立审查页头部升格至 hero 右上（report-context-bar），
   *  详情区只留内容——编写弹窗流不传，保持原位头部。 */
  hideHeader?: boolean;
  /** 处置后任务回写（2026-11-18）：hero 上下文条据此刷新已采纳计数/导出可用态 */
  onTaskUpdate?: (task: ReviewTask) => void;
}

export default function ReportViewCombined({ task: initialTask, onBack, hideBack, hideHeader, onTaskUpdate }: ReportViewCombinedProps) {
  const [task, setTask] = useState<ReviewTask>(initialTask);
  const report = task.results as ReviewReport | null;
  const [issues, setIssues] = useState<Issue[]>(() => report ? flattenReport(report) : []);
  const { onReviewComplete } = useTenderReview();

  // Sync when task prop changes (switching between different reports)
  useEffect(() => {
    setTask(initialTask);
    const newReport = initialTask.results as ReviewReport | null;
    setIssues(newReport ? flattenReport(newReport) : []);
  }, [initialTask]);

  // 筛选状态
  const [filter, setFilter] = useState<FilterKey>('all');
  // 折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['passed', 'skipped', 'dataMissing']));

  // 分组
  const groups: IssueGroup[] = useMemo(() => {
    const g: IssueGroup[] = [
      { key: 'critical', label: '严重违规', icon: <XCircle className="h-3.5 w-3.5" />, iconColor: 'text-[var(--danger)]', dotColor: 'bg-[var(--danger)]', issues: [] },
      { key: 'warning', label: '警告', icon: <AlertTriangle className="h-3.5 w-3.5" />, iconColor: 'text-[var(--warning)]', dotColor: 'bg-[var(--warning)]', issues: [] },
      { key: 'info', label: '提示', icon: <Circle className="h-3.5 w-3.5" />, iconColor: 'text-[var(--accent)]', dotColor: 'bg-[var(--accent)]', issues: [] },
      { key: 'dataMissing', label: '忽略项', icon: <Circle className="h-3.5 w-3.5" />, iconColor: 'text-[var(--muted-foreground)]', dotColor: 'bg-[var(--muted-foreground)]', issues: [] },
      { key: 'passed', label: '通过', icon: <CheckCircle2 className="h-3.5 w-3.5" />, iconColor: 'text-[var(--success)]', dotColor: 'bg-[var(--success)]', issues: [] },
      { key: 'skipped', label: '不适用', icon: <CircleSlash className="h-3.5 w-3.5" />, iconColor: 'text-[var(--muted-foreground)]/60', dotColor: 'bg-[var(--muted-foreground)]/50', issues: [] },
    ];

    issues.forEach((issue, idx) => {
      const entry = { issue, originalIndex: idx };
      if (issue.notApplicable) {
        g.find(gr => gr.key === 'skipped')!.issues.push(entry);
      } else if (issue.dataMissing) {
        g.find(gr => gr.key === 'dataMissing')!.issues.push(entry);
      } else if (issue.passed) {
        g.find(gr => gr.key === 'passed')!.issues.push(entry);
      } else {
        const group = g.find(gr => gr.key === issue.severity);
        if (group) group.issues.push(entry);
      }
    });

    return g;
  }, [issues]);

  // 根据筛选过滤分组
  const filteredGroups = useMemo(() => {
    return filter === 'all' ? groups : groups.filter(g => g.key === filter);
  }, [filter, groups]);

  // 计算各筛选类型的数量
  const counts: Record<FilterKey, number> = useMemo(() => ({
    all: issues.length,
    critical: issues.filter(i => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'critical').length,
    warning: issues.filter(i => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'warning').length,
    info: issues.filter(i => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'info').length,
    dataMissing: issues.filter(i => i.dataMissing === true).length,
    passed: issues.filter(i => i.passed && !i.notApplicable && !i.dataMissing).length,
    skipped: issues.filter(i => i.notApplicable === true).length,
  }), [issues]);

  // 获取所有可见问题的索引
  const visibleIndices = useMemo(() => {
    return filteredGroups.flatMap(g => g.issues.map(e => e.originalIndex));
  }, [filteredGroups]);

  // 初始选中第一个严重问题，否则第一个问题
  const initialIndex = useMemo(() => {
    const firstCritical = visibleIndices.find(idx => {
      const issue = issues[idx];
      return !issue.passed && issue.severity === 'critical';
    });
    if (firstCritical !== undefined) return firstCritical;
    const firstIssue = visibleIndices.find(idx => !issues[idx].passed);
    return firstIssue !== undefined ? firstIssue : (visibleIndices[0] ?? 0);
  }, []);

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  // 当筛选变化时，如果当前选中的问题不可见，自动跳转到第一个可见问题
  useEffect(() => {
    if (visibleIndices.length > 0 && !visibleIndices.includes(selectedIndex)) {
      setSelectedIndex(visibleIndices[0]);
    }
  }, [filter, visibleIndices, selectedIndex]);

  const selectedIssue = issues[selectedIndex];
  const totalIssues = issues.filter(i => !i.passed && !i.notApplicable && !i.dataMissing).length;
  const resolvedCount = issues.filter(i => i.status === 'accepted' || i.status === 'rejected').length;
  const allResolved =
    totalIssues > 0 &&
    issues
      .filter((i) => !i.passed && !i.notApplicable && !i.dataMissing)
      .every((i) => i.status === 'accepted' || i.status === 'rejected');

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function handleResolve(action: 'accept' | 'reject', editedSuggestion?: string) {
    if (!selectedIssue || selectedIssue.passed) return;
    const updated = await resolveIssue(task.id, selectedIndex, action, editedSuggestion);
    setTask(updated);
    setIssues(flattenReport(updated.results as ReviewReport));
    onTaskUpdate?.(updated);
  }

  if (!report?.summary) {
    return (
      <div className="text-center py-8 text-[var(--muted-foreground)] text-xs">
        报告数据不完整
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 详情头（2026-11-18 升格）：独立审查页 hideHeader——返程/导出/文件名在 hero 右上
          （report-context-bar），此处只留终态元素；编写弹窗流仍在原位渲染整条 */}
      {(() => {
        const terminal = allResolved ? (
          onReviewComplete ? (
            <button
              type="button"
              onClick={() => onReviewComplete(task)}
              className="neu-btn-xs is-success gap-1.5 shrink-0"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              审查结束，提交采购文件
            </button>
          ) : (
            /* R6-8③（2026-09-30 审计③）：独立 /tender-review 页无 onReviewComplete（不传项目上下文），
               全部处置完后补终态徽标引导导出留档 */
            <span className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-[var(--success)] shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" />
              全部问题已处置 · 请导出报告留档
            </span>
          )
        ) : null;
        if (hideHeader) {
          return terminal ? (
            <div className="flex shrink-0 justify-end px-4 pt-3">
              {terminal}
            </div>
          ) : null;
        }
        return (
          <div className="flex items-center gap-3 pt-3 px-4 shrink-0">
            <ReportContextBar task={task} onBack={hideBack ? undefined : onBack} />
            {terminal}
          </div>
        );
      })()}
      {/* Stats bar with filter buttons —— 多选一筛选走 neu-tab-bar 内凹轨道规范（2026-11-12 cgzxui 对齐） */}
      <div className="neu-tile flex items-center gap-3 px-3 py-2 shrink-0">
        <div className="neu-tab-bar flex flex-wrap">
          {FILTER_OPTIONS.map((opt) => {
            const count = counts[opt.key];
            if (count === 0 && opt.key !== 'all') return null;
            const isSelected = filter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`neu-tab !px-3 !py-1 !text-xs ${isSelected ? 'is-active' : ''}`}
              >
                {opt.icon && <span className={opt.colorClass}>{opt.icon}</span>}
                {opt.label}
                <span className="neu-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Progress */}
        {totalIssues > 0 && (
          <div className="ml-auto flex items-center gap-2 pl-4 border-l border-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)]">
            <span className="text-xs text-[var(--muted-foreground)]">
              {resolvedCount}/{totalIssues} 已处理
            </span>
            <div className="w-20 h-1.5 rounded-full bg-[oklch(0.55 0.03 258 / 0.1)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${(resolvedCount / totalIssues) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main content: left navigator + right detail */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Issue navigator */}
        <div className="w-[220px] xl:w-[280px] shrink-0 wb-panel rounded-[16px] overflow-hidden flex flex-col">
          {/* Issue groups */}
          <div className="flex-1 overflow-y-auto">
            {filteredGroups.map((group) => {
              if (group.issues.length === 0) return null;
              const isCollapsed = collapsedGroups.has(group.key);

              return (
                <div key={group.key}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-[color:var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={group.iconColor}>{group.icon}</span>
                      <span className="text-xs font-medium">{group.label}</span>
                      <span className="text-xs text-[var(--muted-foreground)]/60">({group.issues.length})</span>
                    </div>
                    <ChevronDown
                      className={`h-3 w-3 transition-transform text-[var(--muted-foreground)]/50 ${isCollapsed ? '' : 'rotate-180'}`}
                    />
                  </button>

                  {/* Group items */}
                  {!isCollapsed && (
                    <div className="pb-1">
                      {group.issues.map(({ issue, originalIndex }) => (
                        <button
                          key={originalIndex}
                          onClick={() => setSelectedIndex(originalIndex)}
                          className={`w-full text-left flex items-start gap-2 px-3 py-2 transition-colors ${
                            selectedIndex === originalIndex
                              ? 'bg-[color-mix(in_oklch,var(--accent-soft)_40%,transparent)]'
                              : 'hover:bg-[color-mix(in_oklch,var(--muted)_20%,transparent)]'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${group.dotColor}`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-[var(--foreground)] leading-snug truncate flex items-center gap-1">
                              <span className="truncate">{issue.title}</span>
                              {issue.source === 'llm-free' && (
                                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)] font-medium">
                                  AI
                                </span>
                              )}
                            </div>
                            {(issue.sectionName || (issue.source && issue.source !== 'llm-free')) && (
                              <div className="text-[10px] text-[var(--muted-foreground)]/50 mt-0.5 truncate">
                                {issue.sectionName || issue.source}
                              </div>
                            )}
                          </div>
                          {issue.status === 'accepted' && (
                            <Check className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
                          )}
                          {issue.status === 'rejected' && (
                            <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]/40 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {visibleIndices.length === 0 && (
              <div className="text-center py-12 text-[var(--muted-foreground)]/40 text-xs">
                未发现问题
              </div>
            )}
          </div>
        </div>

        {/* Right: Issue detail */}
        <div className="flex-1 wb-panel rounded-[16px] overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            {selectedIssue ? (
              <motion.div
                key={selectedIndex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Problem detail */}
                <section className="neu-tile p-4">
                  <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-3 flex items-center gap-1.5">
                    {selectedIssue.notApplicable ? '不适用' : selectedIssue.passed ? '通过' : (
                      <>
                        <Search className="h-3.5 w-3.5" />
                        问题详情
                      </>
                    )}
                  </div>
                  <div className={`rounded-[12px] p-3 shadow-[inset_1px_2px_4px_oklch(0.55_0.03_258_/_0.1),inset_-1px_-1px_3px_oklch(1_0_0_/_0.6)] ${
                    selectedIssue.notApplicable
                      ? 'bg-[color-mix(in_oklch,var(--muted)_15%,transparent)]'
                      : selectedIssue.passed
                      ? 'bg-[color-mix(in_oklch,var(--success)_6%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--danger)_6%,transparent)]'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-[4px] font-medium ${SEVERITY_COLORS[selectedIssue.severity]}`}>
                        {SEVERITY_LABELS[selectedIssue.severity]}
                      </span>
                      {selectedIssue.source === 'llm-free' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[color-mix(in_oklch,var(--accent-soft)_45%,transparent)] text-[color:var(--accent)] font-medium">
                          AI 自主判断
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-[4px] ${
                        selectedIssue.status === 'accepted' ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[color:var(--success)]' :
                        selectedIssue.status === 'rejected' ? 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[color:var(--danger)]' :
                        'bg-[color-mix(in_oklch,var(--muted)_25%,transparent)] text-[color:var(--muted-foreground)]'
                      }`}>
                        {selectedIssue.status === 'accepted' ? '已采纳' :
                         selectedIssue.status === 'rejected' ? '已拒绝' : '待处理'}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-[var(--foreground)] mb-2">
                      {selectedIssue.title}
                    </h3>
                    {selectedIssue.description && (
                      <div className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                        {selectedIssue.description}
                      </div>
                    )}
                  </div>
                </section>

                {/* Original text comparison */}
                {(selectedIssue.documentExcerpt || selectedIssue.documentLocation?.excerpt || selectedIssue.kbExcerpt || selectedIssue.knowledgeBaseReferences?.[0]?.clauseContent) && (
                  <section className="neu-tile p-4">
                    <OriginalTextCompare
                      documentExcerpt={selectedIssue.documentExcerpt}
                      documentFileName={task.documentName}
                      documentLocation={selectedIssue.documentLocation}
                      kbExcerpt={selectedIssue.kbExcerpt}
                      knowledgeBaseReferences={selectedIssue.knowledgeBaseReferences}
                    />
                  </section>
                )}

                {/* Suggestion editor */}
                {selectedIssue.passed !== true && !selectedIssue.notApplicable && !selectedIssue.dataMissing && (
                  <section className="neu-tile p-4">
                    <SuggestionEditor
                      taskId={task.id}
                      issueIndex={selectedIndex}
                      suggestion={selectedIssue.suggestion || ''}
                      editedSuggestion={selectedIssue.editedSuggestion}
                      status={selectedIssue.status || 'pending'}
                      onResolved={handleResolve}
                    />
                  </section>
                )}
              </motion.div>
            ) : (
              <div className="text-center py-20 text-[var(--muted-foreground)] text-xs">
                选择左侧问题查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}