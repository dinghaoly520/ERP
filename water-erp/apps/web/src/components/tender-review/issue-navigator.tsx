'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import type { Issue } from '@/lib/types/tender-review';

type FilterKey = 'all' | 'critical' | 'warning' | 'info' | 'dataMissing' | 'passed' | 'skipped';

interface IssueNavigatorProps {
  issues: Issue[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

interface IssueGroup {
  key: string;
  label: string;
  emoji: string;
  issues: Array<{ issue: Issue; originalIndex: number }>;
}

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'critical', label: '严重' },
  { key: 'warning', label: '警告' },
  { key: 'info', label: '提示' },
  { key: 'dataMissing', label: '忽略项' },
  { key: 'passed', label: '通过' },
  { key: 'skipped', label: '跳过' },
];

export default function IssueNavigator({
  issues,
  selectedIndex,
  onSelect,
}: IssueNavigatorProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['passed', 'skipped']));

  const groups: IssueGroup[] = [
    { key: 'critical', label: '严重违规', emoji: '🔴', issues: [] },
    { key: 'warning', label: '警告', emoji: '🟡', issues: [] },
    { key: 'info', label: '提示', emoji: '🔵', issues: [] },
    { key: 'dataMissing', label: '忽略项', emoji: '🟠', issues: [] },
    { key: 'passed', label: '通过', emoji: '✅', issues: [] },
    { key: 'skipped', label: '不适用', emoji: '⬜', issues: [] },
  ];

  issues.forEach((issue, idx) => {
    const entry = { issue, originalIndex: idx };
    if (issue.notApplicable) {
      groups.find((g) => g.key === 'skipped')!.issues.push(entry);
    } else if (issue.dataMissing) {
      groups.find((g) => g.key === 'dataMissing')!.issues.push(entry);
    } else if (issue.passed) {
      groups.find((g) => g.key === 'passed')!.issues.push(entry);
    } else {
      const group = groups.find((g) => g.key === issue.severity);
      if (group) group.issues.push(entry);
    }
  });

  const filteredGroups = filter === 'all'
    ? groups
    : groups.filter((g) => g.key === filter);

  const counts: Record<FilterKey, number> = {
    all: issues.length,
    critical: issues.filter((i) => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'critical').length,
    warning: issues.filter((i) => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'warning').length,
    info: issues.filter((i) => !i.passed && !i.notApplicable && !i.dataMissing && i.severity === 'info').length,
    dataMissing: issues.filter((i) => i.dataMissing === true).length,
    passed: issues.filter((i) => i.passed && !i.notApplicable && !i.dataMissing).length,
    skipped: issues.filter((i) => i.notApplicable === true).length,
  };

  // Auto-select first visible issue if selected is hidden
  useEffect(() => {
    const visibleIndices = filteredGroups.flatMap((g) =>
      g.issues.map((e) => e.originalIndex),
    );
    if (visibleIndices.length > 0 && !visibleIndices.includes(selectedIndex)) {
      onSelect(visibleIndices[0]);
    }
  }, [filter, filteredGroups, selectedIndex, onSelect]);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-white/5">
        {FILTER_OPTIONS.map((opt) => {
          const count = counts[opt.key];
          if (count === 0 && opt.key !== 'all') return null;
          return (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-1.5 py-0.5 rounded-md whitespace-nowrap transition-colors ${
                filter === opt.key
                  ? 'bg-indigo-500 text-white'
                  : 'bg-transparent text-[var(--muted-foreground)] border border-white/5 hover:border-white/10'
              }`}
              style={{ fontSize: 12 }}
            >
              {opt.label}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Issue groups */}
      <div className="flex-1 overflow-y-auto">
        {filteredGroups.map((group) => {
          if (group.issues.length === 0 && group.key !== 'passed') return null;

          const isCollapsed = collapsed.has(group.key);

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center justify-between px-4 py-2 text-[var(--muted-foreground)] bg-[var(--muted-foreground)]/[0.03] hover:bg-[var(--muted-foreground)]/[0.06] transition-colors border-b border-white/[0.03]"
              style={{ fontSize: 12 }}
              >
                <span>{group.emoji} {group.label} ({group.issues.length})</span>
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                />
              </button>

              {!isCollapsed && group.issues.length === 0 && (
                <div className="px-4 py-3 text-[11px] text-[var(--muted-foreground)]/40 text-center">
                  无
                </div>
              )}

              {!isCollapsed && group.issues.map(({ issue, originalIndex }) => (
                <button
                  key={originalIndex}
                  onClick={() => onSelect(originalIndex)}
                  className={`w-full text-left flex items-start gap-2.5 px-4 py-2.5 border-b border-white/[0.03] transition-colors ${
                    selectedIndex === originalIndex
                      ? 'bg-indigo-500/[0.08] border-l-[3px] border-l-indigo-400'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      issue.passed
                        ? 'bg-[rgba(92,181,150,1)]'
                        : issue.dataMissing
                        ? 'bg-[rgba(234,188,110,1)]'
                        : issue.severity === 'critical'
                        ? 'bg-[rgba(230,129,102,1)]'
                        : issue.severity === 'warning'
                        ? 'bg-[rgba(234,188,110,0.8)]'
                        : 'bg-[rgba(96,139,239,1)]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--foreground)] leading-snug truncate">
                      {issue.title}
                    </div>
                    <div className="text-[11px] text-[var(--muted-foreground)]/50 mt-0.5 truncate">
                      {issue.sectionName || issue.source || ''}
                    </div>
                  </div>
                  {issue.status === 'accepted' && (
                    <span className="text-[rgba(92,181,150,1)] shrink-0 mt-0.5">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {issue.status === 'rejected' && (
                    <span className="text-[var(--muted-foreground)]/40 shrink-0 mt-0.5">
                      <X className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}

        {issues.length === 0 && (
          <div className="text-center py-12 text-[var(--muted-foreground)]/40 text-xs">
            ✅ 未发现问题
          </div>
        )}
      </div>
    </div>
  );
}
