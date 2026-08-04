'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, Bell, Clock, Users, Search, X, Check } from 'lucide-react';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@water-erp/shared';

export type Visibility = 'PUBLIC' | 'RESTRICTED';
export type ScheduleMode = 'immediate' | 'scheduled';

export interface PublishConfig {
  visibility: Visibility;
  restrictedSupplierIds: string[];
  notifyOnPublish: boolean;
  scheduleMode: ScheduleMode;
  scheduledPublishDate: string; // ISO datetime-local format: 2026-08-04T12:00
}

export const DEFAULT_PUBLISH_CONFIG: PublishConfig = {
  visibility: 'PUBLIC',
  restrictedSupplierIds: [],
  notifyOnPublish: true,
  scheduleMode: 'immediate',
  scheduledPublishDate: '',
};

/** 从公告 metadata 恢复发布配置 */
export function configFromMetadata(meta: Record<string, any> | null | undefined): PublishConfig {
  if (!meta) return { ...DEFAULT_PUBLISH_CONFIG };
  return {
    visibility: meta.visibility === 'RESTRICTED' ? 'RESTRICTED' : 'PUBLIC',
    restrictedSupplierIds: Array.isArray(meta.restrictedSupplierIds) ? meta.restrictedSupplierIds : [],
    notifyOnPublish: meta.notifyOnPublish !== false,
    scheduleMode: meta.scheduledPublishDate ? 'scheduled' : 'immediate',
    scheduledPublishDate: meta.scheduledPublishDate ? meta.scheduledPublishDate.slice(0, 16) : '',
  };
}

/** 将发布配置写入 metadata（供 create/update payload 使用） */
export function configToMetadata(config: PublishConfig, base: Record<string, any> = {}): Record<string, any> {
  const meta: Record<string, any> = { ...base };
  meta.visibility = config.visibility;
  if (config.visibility === 'RESTRICTED') {
    meta.restrictedSupplierIds = config.restrictedSupplierIds;
  } else {
    delete meta.restrictedSupplierIds;
  }
  meta.notifyOnPublish = config.notifyOnPublish;
  if (config.scheduleMode === 'scheduled' && config.scheduledPublishDate) {
    meta.scheduledPublishDate = config.scheduledPublishDate;
  } else {
    delete meta.scheduledPublishDate;
  }
  return meta;
}

/* ════════════ 组件 ════════════ */

export function PublishConfigSection({
  config,
  onChange,
}: {
  config: PublishConfig;
  onChange: (next: PublishConfig) => void;
}) {
  const update = (patch: Partial<PublishConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-4">
      {/* 可见范围 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">
          <Eye size={12} />可见范围
        </label>
        <div className="neu-tab-bar inline-flex">
          <button
            type="button"
            onClick={() => update({ visibility: 'PUBLIC' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.visibility === 'PUBLIC' ? 'is-active' : ''}`}
          >
            全部可见
          </button>
          <button
            type="button"
            onClick={() => update({ visibility: 'RESTRICTED' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.visibility === 'RESTRICTED' ? 'is-active' : ''}`}
          >
            部分供应商可见
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          {config.visibility === 'PUBLIC'
            ? '所有已启用供应商均可在供应商门户及首页查看此公告'
            : '仅被选中的供应商可在供应商门户查看；首页不展示'}
        </p>
      </div>

      {/* 部分供应商：选择器 */}
      {config.visibility === 'RESTRICTED' && (
        <SupplierPicker
          selectedIds={config.restrictedSupplierIds}
          onSelectedIdsChange={(ids) => update({ restrictedSupplierIds: ids })}
        />
      )}

      <div className="rounded-lg bg-[color-mix(in_oklch,var(--surface)_60%,transparent)] px-3 py-px" style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }} />

      {/* 通知设置 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">
          <Bell size={12} />通知设置
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.notifyOnPublish}
            onChange={(e) => update({ notifyOnPublish: e.target.checked })}
            className="neu-checkbox"
          />
          <span className="text-sm text-[var(--foreground)]">
            发布时向{config.visibility === 'PUBLIC' ? '全部' : '选中'}供应商发送站内通知
          </span>
        </label>
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          通知包含公告标题与链接，供应商可在通知中心直接跳转查看
        </p>
      </div>

      <div className="rounded-lg bg-[color-mix(in_oklch,var(--surface)_60%,transparent)] px-3 py-px" style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }} />

      {/* 发布时间 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">
          <Clock size={12} />发布时间
        </label>
        <div className="neu-tab-bar inline-flex">
          <button
            type="button"
            onClick={() => update({ scheduleMode: 'immediate' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.scheduleMode === 'immediate' ? 'is-active' : ''}`}
          >
            立即发布
          </button>
          <button
            type="button"
            onClick={() => update({ scheduleMode: 'scheduled' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.scheduleMode === 'scheduled' ? 'is-active' : ''}`}
          >
            定时发布
          </button>
        </div>
        {config.scheduleMode === 'scheduled' && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={config.scheduledPublishDate}
              onChange={(e) => update({ scheduledPublishDate: e.target.value })}
              className="neu-input text-sm"
            />
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              到达设定时间后系统自动发布并发送通知（精确到分钟）
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════ 供应商选择器 ════════════ */

function SupplierPicker({
  selectedIds,
  onSelectedIdsChange,
}: {
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSuppliers, setSelectedSuppliers] = useState<Map<string, string>>(new Map());

  // 初始加载已选供应商名称
  const loadSelectedNames = useCallback(async () => {
    if (selectedIds.length === 0) return;
    // 从搜索结果或逐个加载
    const known = new Map(selectedSuppliers);
    const unknown = selectedIds.filter((id) => !known.has(id));
    if (unknown.length === 0) return;
    try {
      const res = await getSupplierList({ pageSize: 200, status: 'APPROVED' });
      for (const s of res.items) {
        if (selectedIds.includes(s.id)) known.set(s.id, s.name);
      }
      setSelectedSuppliers(known);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  useEffect(() => {
    loadSelectedNames();
  }, [loadSelectedNames]);

  // 搜索
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await getSupplierList({ search: search.trim(), pageSize: 20, status: 'APPROVED' });
        if (!cancelled) {
          setResults(res.items);
          // 缓存搜索到的供应商名称
          const m = new Map(selectedSuppliers);
          for (const s of res.items) m.set(s.id, s.name);
          setSelectedSuppliers(m);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
      if (!cancelled) setLoading(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleSupplier = (id: string, name: string) => {
    const m = new Map(selectedSuppliers);
    m.set(id, name);
    setSelectedSuppliers(m);
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  const removeSelected = (id: string) => {
    onSelectedIdsChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div className="space-y-2">
      {/* 已选标签 */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-lg bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--accent)]"
            >
              {selectedSuppliers.get(id) || id.slice(-8)}
              <button type="button" onClick={() => removeSelected(id)} className="opacity-70 hover:opacity-100">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索供应商名称..."
          className="neu-input !pl-9 text-sm"
        />
      </div>

      {/* 搜索结果 */}
      {search.trim() && (
        <div className="max-h-[240px] overflow-y-auto space-y-1 rounded-xl bg-[var(--surface)] p-2" style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
          {loading ? (
            <p className="text-xs text-[var(--muted-foreground)] text-center py-3">搜索中...</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)] text-center py-3">未匹配到供应商</p>
          ) : (
            results.map((s) => {
              const checked = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSupplier(s.id, s.name)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[var(--foreground)] truncate">{s.name}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                      {s.enterpriseType}{s.creditCode ? ` · ${s.creditCode}` : ''}
                    </div>
                  </div>
                  <span
                    className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] ${
                      checked
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[color-mix(in_oklch,var(--surface)_80%,transparent)] text-transparent'
                    }`}
                    style={{ boxShadow: checked ? 'none' : 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }}
                  >
                    <Check size={11} strokeWidth={3} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {selectedIds.length === 0 && !search.trim() && (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          <Users size={11} className="inline mr-1" />
          请搜索并选择可见供应商
        </p>
      )}
    </div>
  );
}
