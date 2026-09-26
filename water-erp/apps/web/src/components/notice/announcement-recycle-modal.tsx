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

const FROM_STATUS_LABELS: Partial<Record<AnnouncementStatus, string>> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已公示',
};

const TYPE_LABELS: Record<string, string> = {
  BID_NOTICE: '采购公告', ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告',
  PRE_WIN_NOTICE: '中标公告', WIN_NOTICE: '成交公告', CONTRACT_NOTICE: '合同公告',
  PERFORMANCE_NOTICE: '履行结果公告', POLICY: '政策法规', PLATFORM: '平台通知',
  FAILED_BID_NOTICE: '流标公告', WIN_BID_NOTICE: '中标公告',
};

/**
 * 回收站（2026-09-26）：隐藏/下架的公告进入此处；可查看详情（原详情页 iframe 弹窗）与恢复；
 * 不提供清空——UI 无任何公告永久删除入口（后端 DELETE 保留但停用）。
 */
export function AnnouncementRecycleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ status: 'HIDDEN,OFFLINE', page: p, pageSize: PAGE_SIZE });
      setData({ total: res.total, items: res.items });
      setPage(p);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const restore = async (a: AnnouncementListItem) => {
    try {
      await restoreAnnouncement(a.id);
      toast.success(`已恢复「${a.title}」`);
      await load(1);
      onChanged();
    } catch (e: any) { toast.error(e?.message || '恢复失败'); }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={<span className="flex items-center gap-2"><Trash2 size={16} className="text-[var(--accent)]" /> 回收站</span>}
        description="隐藏与下架的公告进入回收站，可查看详情或恢复；回收站不提供清空操作"
        size="2xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">共 {data.total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex items-center gap-2">
              <button disabled={loading || page <= 1} onClick={() => load(page - 1)} className="neu-btn-xs disabled:opacity-40">上一页</button>
              <button disabled={loading || page >= totalPages} onClick={() => load(page + 1)} className="neu-btn-xs disabled:opacity-40">下一页</button>
              <button onClick={onClose} className="neu-btn-soft">关闭</button>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[680px]">
            <thead>
              <tr>
                <th>标题</th>
                <th>类型</th>
                <th>原因 / 原状态</th>
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
                      <p className="text-sm text-[var(--muted-foreground)]">回收站为空——隐藏或下架的公告会出现在这里</p>
                    </div>
                  </td>
                </tr>
              ) : data.items.map(a => {
                const rc = a.metadata?.recycle as { from?: AnnouncementStatus; action?: string; at?: string; by?: string | null } | undefined;
                const offline = a.status === 'OFFLINE';
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="text-sm font-bold text-[var(--foreground)]">{a.title}</div>
                      {a.relatedProjectCode && <div className="text-[11px] text-[var(--muted-foreground)]">{a.relatedProjectCode}</div>}
                    </td>
                    <td><StatusBadge tone="gray">{TYPE_LABELS[a.type] ?? '公告'}</StatusBadge></td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={offline ? 'orange' : 'gray'}>
                          {offline
                            ? <span className="inline-flex items-center gap-1"><PackageX size={11} /> 下架</span>
                            : <span className="inline-flex items-center gap-1"><EyeOff size={11} /> 隐藏</span>}
                        </StatusBadge>
                        <span className="text-[11px] text-[var(--muted-foreground)]">原状态：{FROM_STATUS_LABELS[rc?.from ?? 'DRAFT'] ?? '草稿'}</span>
                      </div>
                    </td>
                    <td className="text-xs tabular-nums text-[var(--muted-foreground)]">{rc?.at ? new Date(rc.at).toLocaleString('zh-CN') : '—'}</td>
                    <td className="text-xs text-[var(--muted-foreground)]">{rc?.by ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        <button onClick={() => setView({ id: a.id, title: a.title })} className="neu-btn-xs"><ExternalLink size={12} /> 查看</button>
                        <button onClick={() => restore(a)} className="neu-btn-xs is-success"><RotateCcw size={12} /> 恢复</button>
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
          description="公告详情（回收站内查看；恢复请回到回收站列表）"
          size="4xl"
        >
          <iframe src={`/notice/${view.id}`} title={view.title} className="h-[74vh] w-full rounded-[12px] border-0 bg-white" />
        </Modal>
      )}
    </>
  );
}
