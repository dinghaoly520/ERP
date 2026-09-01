'use client';

import { useMemo, useState } from 'react';
import { MessageSquare, Plus, ChevronDown, ChevronRight, ArrowLeft, Trash2 } from 'lucide-react';
import styles from './history-sidebar.module.css';

export interface ConversationItem {
  id: string;
  title: string | null;
  firstMessage: string;
  createdAt: string;
  updatedAt: string;
}

interface GroupedConversations {
  label: string;
  items: ConversationItem[];
}

function extractTitle(item: ConversationItem): string {
  // Prefer existing title (first 30 chars of first message)
  if (item.title && item.title.length > 3) return item.title;

  const raw = item.firstMessage || '';
  if (!raw) return '新对话';

  // Strip leading guide words
  const cleaned = raw
    .replace(/^(请帮我|帮我|请|我想|麻烦|帮我看看|请你|能否|可以)\s*/g, '')
    .trim();

  // Take first 20 characters
  if (cleaned.length <= 20) return cleaned;
  return cleaned.slice(0, 20) + '...';
}

function groupByDate(items: ConversationItem[]): GroupedConversations[] {
  const groups: Record<string, ConversationItem[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  for (const item of items) {
    const d = new Date(item.updatedAt);
    const dateKey = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    let label: string;
    if (dateKey.getTime() === today.getTime()) {
      label = '今天';
    } else if (dateKey.getTime() === yesterday.getTime()) {
      label = '昨天';
    } else {
      label = `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  // Preserve insertion order
  const seen = new Set<string>();
  const result: GroupedConversations[] = [];
  for (const item of items) {
    const d = new Date(item.updatedAt);
    const dateKey = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label: string;
    if (dateKey.getTime() === today.getTime()) {
      label = '今天';
    } else if (dateKey.getTime() === yesterday.getTime()) {
      label = '昨天';
    } else {
      label = `${d.getMonth() + 1}月${d.getDate()}日`;
    }
    if (!seen.has(label)) {
      seen.add(label);
      result.push({ label, items: groups[label] });
    }
  }

  return result;
}

export function HistorySidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onBack,
  onDelete,
  collapsed,
  onToggleCollapse,
}: {
  conversations: ConversationItem[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
  onBack?: () => void;
  onDelete?: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
}) {
  const grouped = useMemo(() => groupByDate(conversations), [conversations]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    // First two groups expanded by default
    const names = grouped.map((g) => g.label).slice(0, 2);
    return new Set(names);
  });

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  if (collapsed) {
    return (
      <aside className={styles.sidebarCollapsed}>
        <button
          className={styles.expandBtn}
          onClick={() => onToggleCollapse(false)}
          type="button"
          aria-label="展开历史对话"
        >
          <ChevronRight size={18} strokeWidth={1.8} />
        </button>
        <div className={styles.collapsedDots}>
          {conversations.slice(0, 10).map((c) => (
            <button
              key={c.id}
              className={`${styles.collapsedDot} ${c.id === activeId ? styles.collapsedDotActive : ''}`}
              onClick={() => onSelect(c.id)}
              type="button"
              title={extractTitle(c)}
            />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      {/* 品牌区 */}
      <div className={styles.brand}>
        <img src="/logo.jpg" alt="四川省水利发展集团有限公司" className={styles.brandLogo} />
        <span className={styles.brandName}>四川省水利发展集团有限公司</span>
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <MessageSquare size={16} strokeWidth={1.8} />
          <span>历史对话</span>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.newBtn}
            onClick={onNew}
            type="button"
            title="新对话"
          >
            <Plus size={16} strokeWidth={2} />
          </button>
          <button
            className={styles.collapseBtn}
            onClick={() => onToggleCollapse(true)}
            type="button"
            aria-label="收起历史对话"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className={styles.list}>
        {grouped.length === 0 && (
          <p className={styles.empty}>暂无历史对话</p>
        )}
        {grouped.map((group) => {
          const isExpanded = expandedGroups.has(group.label);
          return (
            <div key={group.label} className={styles.group}>
              <button
                className={styles.groupLabel}
                onClick={() => toggleGroup(group.label)}
                type="button"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`${styles.groupChevron} ${isExpanded ? styles.groupChevronOpen : ''}`}
                />
                {group.label}
                <span className={styles.groupCount}>{group.items.length}</span>
              </button>
              {isExpanded && (
                <div className={styles.groupItems}>
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className={`${styles.item} ${item.id === activeId ? styles.itemActive : ''}`}
                      onClick={() => onSelect(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelect(item.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className={styles.itemText}>{extractTitle(item)}</span>
                      {onDelete && (
                        <button
                          className={styles.deleteBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(item.id);
                          }}
                          type="button"
                          title="删除对话"
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部返回按钮 */}
      {onBack && (
        <button
          className={styles.backBtn}
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>返回首页</span>
        </button>
      )}
    </aside>
  );
}
