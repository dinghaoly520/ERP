'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/workbench';
import { BusinessTagReview } from './business-tag-review';
import { SupplierPasswordResetPanel } from './password-reset-panel';
import { ChangeReviewPanel } from './change-review-panel';
import { fetchSupplierPasswordResets, fetchPendingSupplierChanges, listBusinessTags } from '@/lib/api/supplier';

/** 审批中心弹窗：业务标签 / 密码重置 / 资料变更 三类供应商相关审批。
 *  顶部 neu-tab-bar 切换（带待审计数徽标，默认落在有待办的一类），内容区懒挂载。
 *  供应商注册申请审核在独立的「供应商审批」页，不在此处。 */

type TabKey = 'tags' | 'resets' | 'changes';

export function ReviewHubModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('tags');
  const [counts, setCounts] = useState<Record<TabKey, number>>({ tags: 0, resets: 0, changes: 0 });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      listBusinessTags('PENDING').catch(() => []),
      fetchSupplierPasswordResets().catch(() => []),
      fetchPendingSupplierChanges().catch(() => []),
    ]).then(([tags, resets, changes]) => {
      if (!alive) return;
      const next = { tags: (tags as unknown[]).length, resets: (resets as unknown[]).length, changes: (changes as unknown[]).length };
      setCounts(next);
      // 默认落在有待办的一类（顺序：标签 → 密码 → 资料），全空停在第一类
      const first = (['tags', 'resets', 'changes'] as TabKey[]).find(k => next[k] > 0) ?? 'tags';
      setTab(first);
    });
    return () => { alive = false; };
  }, [open]);

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'tags', label: '业务标签' },
    { key: 'resets', label: '密码重置' },
    { key: 'changes', label: '资料变更' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="供应商审批"
      size="2xl"
      footer={<span className="text-xs text-[var(--muted-foreground)]">标签入池 · 密码重置 · 资料变更的日常审批 ｜ 供应商注册申请审核请前往「供应商审批」页</span>}
    >
      <div className="flex flex-col gap-4">
        <div className="neu-tab-bar">
          {TABS.map(t => (
            <button key={t.key} type="button" className={`neu-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {counts[t.key] > 0 && <span className="neu-tab-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        {tab === 'tags' && <BusinessTagReview />}
        {tab === 'resets' && <SupplierPasswordResetPanel />}
        {tab === 'changes' && <ChangeReviewPanel />}
      </div>
    </Modal>
  );
}
