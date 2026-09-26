'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, StatusBadge, TableSkeleton } from '@/components/workbench';
import {
  listAnnouncements, restoreAnnouncement,
  type AnnouncementListItem, type AnnouncementStatus,
} from '@/lib/api/announcement';
import { toast } from 'sonner';
import { EyeOff, PackageX, RotateCcw, FileText, ExternalLink, Trash2 } from 'lucide-react';

const PAGE_SIZE = 15;

/** 回收站两节（v2 拍板 2026-09-26）：已隐藏（可恢复）/ 已下架（终态，仅查看）。无清空操作。 */
type RecycleTab = 'HIDDEN' | 'OFFLINE';

const TABS: Array<{ key: RecycleTab; label: string }> = [
  { key: 'HIDDEN', label: '已隐藏' },
  { key: 'OFFLINE', label: '已下架' },
];

const FROM_STATUS_LABELS: Partial<Record<AnnouncementStatus, string>> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已下线',
};

const TYPE_LABELS: Record<string, string> = {
  BID_NOTICE: '采购公告', ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告',
  PRE_WIN_NOTICE: '中标公告', WIN_NOTICE: '成交公告', CONTRACT_NOTICE: '合同公告',
  PERFORMANCE_NOTICE: '履行结果公告', POLICY: '政策法规', PLATFORM: '平台通知',
  FAILED_BID_NOTICE: '流标公告', WIN_BID_NOTICE: '中标公告',
};

/**
 * 回收站（2026-09-26 v2）：分「已隐藏 / 已下架」两节。
 * 已隐藏：查看 + 恢复（还原到隐藏前状态）；已下架：仅查看（下架为终态，不可恢复）。
 * 不提供清空——UI 无任何公告永久删除入口（后端 DELETE 保留但停用）。
 */
export function AnnouncementRecycleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<RecycleTab>('HIDDEN');
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async (t: RecycleTab, p: number) => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ status: t, page: p, pageSize: PAGE_SIZE });
      setData({ total: res.total, items: res.items });
      setPage(p);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load('HIDDEN', 1); }, [load]);

  const switchTab = (t: RecycleTab) => {
    if (t === tab) return;
    setTab(t);
    load(t, 1);
  };

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const restore = async (a: AnnouncementListItem) => {
    try {
      await restoreAnnouncement(a.id);
      toast.success(`已恢复「${a.title}」`);
      await load('HIDDEN', 1);
      onChanged();
    } catch (e: any) { toast.error(e?.message || '恢复失败'); }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={<span className="flex items-center gap-2"><Trash2 size={16} className="text-[var(--accent)]" /> 回收站</span>}
        description="隐藏与下架的公告分节存放：已隐藏可恢复，已下架为终态仅可查看；不提供清空操作"
        size="2xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">共 {data.total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex items-center gap-2">
              <button disabled={loading || page <= 1} onClick={() => load(tab, page - 1)} className="neu-btn-xs disabled:opacity-40">上一页</button>
              <button disabled={loading || page >= totalPages} onClick={() => load(tab, page + 1)} className="neu-btn-xs disabled:opacity-40">下一页</button>
              <button onClick={onClose} className="neu-btn-soft">关闭</button>
            </div>
          </div>
        }
      >
        {/* 两节切换：已隐藏（可恢复）/ 已下架（终态） */}
        <div className="neu-segment mb-3" role="group" aria-label="回收站分节" data-count="2" data-index={String(TABS.findIndex((t) => t.key === tab))}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="neu-segment-btn"
              aria-pressed={tab === t.key}
              onClick={() => switchTab(t.key)}
            >
              {t.key === 'HIDDEN' ? <EyeOff size={13} /> : <PackageX size={13} />} {t.label}{tab === t.key ? ` ${data.total}` : ''}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[640px]">
            <thead>
              <tr>
                <th>标题</th>
                <th>类型</th>
                <th>原状态</th>
                <th>进入时间</th>
                <th>操作人</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={6} rows={4} />
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <div className="flex flex-col items-center gap-2">
                      <FileText size={20} className="text-[var(--muted-foreground)]" />
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {tab === 'HIDDEN' ? '暂无隐藏的公告——隐藏的公告会出现在这里' : '暂无下架的公告——下架的公告会出现在这里（不可恢复）'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : data.items.map(a => {
                const rc = a.metadata?.recycle as { from?: AnnouncementStatus; action?: string; at?: string; by?: string | null } | undefined;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="text-sm font-bold text-[var(--foreground)]">{a.title}</div>
                      {a.relatedProjectCode && <div className="text-[11px] text-[var(--muted-foreground)]">{a.relatedProjectCode}</div>}
                    </td>
                    <td><StatusBadge tone="gray">{TYPE_LABELS[a.type] ?? '公告'}</StatusBadge></td>
                    <td><StatusBadge tone="gray">{FROM_STATUS_LABELS[rc?.from ?? 'DRAFT'] ?? '草稿'}</StatusBadge></td>
                    <td className="text-xs tabular-nums text-[var(--muted-foreground)]">{rc?.at ? new Date(rc.at).toLocaleString('zh-CN') : '—'}</td>
                    <td className="text-xs text-[var(--muted-foreground)]">{rc?.by ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        <button onClick={() => setView({ id: a.id, title: a.title })} className="neu-btn-xs"><ExternalLink size={12} /> 查看</button>
                        {tab === 'HIDDEN' && (
                          <button onClick={() => restore(a)} className="neu-btn-xs is-success"><RotateCcw size={12} /> 恢复</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* 详情窗口：以正常公告详情页（/notice/[id]）原样加载 */}
      {view && (
        <Modal
          open
          onClose={() => setView(null)}
          title={<span className="flex items-center gap-2"><FileText size={16} className="text-[var(--accent)]" /> {view.title}</span>}
          description="公告详情（回收站内查看；恢复请回到回收站「已隐藏」节）"
          size="4xl"
        >
          <iframe src={`/notice-view/${view.id}`} title={view.title} className="h-[74vh] w-full rounded-[12px] border-0 bg-white" />
        </Modal>
      )}
    </>
  );
}
