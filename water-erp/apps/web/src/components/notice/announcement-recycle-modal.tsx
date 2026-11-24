'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, StatusBadge, TableSkeleton } from '@/components/workbench';
import {
  listAnnouncements, restoreAnnouncement, deleteAnnouncement,
  type AnnouncementListItem, type AnnouncementStatus,
} from '@/lib/api/announcement';
import { toast } from 'sonner';
import { EyeOff, RotateCcw, FileText, ExternalLink, Trash2 } from 'lucide-react';
import { ANN_TYPE_LABEL, ANN_TYPE_TONE, ANN_STATUS_LABEL } from '@/lib/announcement-meta';
import { scheduledPublishDue } from '@/lib/notice/schedule';
import { useConfirm } from '@/components/workbench/use-confirm';

const PAGE_SIZE = 15;

const FROM_STATUS_LABELS: Partial<Record<AnnouncementStatus, string>> = {
  DRAFT: ANN_STATUS_LABEL.DRAFT, PUBLISHED: ANN_STATUS_LABEL.PUBLISHED, ARCHIVED: ANN_STATUS_LABEL.ARCHIVED,
};

const TYPE_LABELS: Record<string, string> = ANN_TYPE_LABEL; // 统一 lib/announcement-meta（2026-09-29 R5）

/**
 * 回收站（2026-11-16「下架」退役改版）：单节只收「已隐藏」件，行操作 = 查看 + 恢复 + 永久删除。
 * 删除走既有 DELETE 端点（BID_IN_PROGRESS 闸门在后端）；隐藏/恢复/删除均落公告历史。
 */
export function AnnouncementRecycleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<{ id: string; title: string } | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ status: 'HIDDEN', page: p, pageSize: PAGE_SIZE });
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

  const remove = async (a: AnnouncementListItem) => {
    if (!(await confirm({
      title: '永久删除公告',
      message: `确认永久删除「${a.title}」？删除后不可恢复，删除记录将留档公告历史；如该公告关联的投标项目正在投标/开标/评标流程中，将无法删除。`,
      danger: true,
    }))) return;
    try {
      await deleteAnnouncement(a.id);
      toast.success(`已永久删除「${a.title}」`);
      await load(page);
      onChanged();
    } catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  return (
    <>
      {dialog}
      <Modal
        open
        onClose={onClose}
        title={<span className="flex items-center gap-2"><Trash2 size={16} className="text-[var(--accent)]" /> 回收站</span>}
        description="隐藏的公告在此存放：可恢复到隐藏前状态，或永久删除（删除留档公告历史）"
        size="3xl"
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
                <th>原状态</th>
                <th>进入时间</th>
                <th>操作人</th>
                <th style={{ textAlign: 'center', width: 220 }}>操作</th>
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
                      <p className="text-sm text-[var(--muted-foreground)]">暂无隐藏的公告——隐藏的公告会出现在这里</p>
                    </div>
                  </td>
                </tr>
              ) : data.items.map(a => {
                const rc = a.metadata?.recycle as { from?: AnnouncementStatus; action?: string; at?: string; by?: string | null } | undefined;
                // 原状态对齐主列表展示口径（2026-11-16）：定时草稿（from=DRAFT 且带 scheduledPublishDate）
                // 主列表显示「待发布」，此处裸取 DB 状态显示「草稿」与之矛盾——同口径派生 + 状态色对齐（待发布蓝/已发布绿）
                const from = rc?.from ?? 'DRAFT';
                const wasScheduled = from === 'DRAFT' && !!scheduledPublishDue(a.metadata?.scheduledPublishDate);
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="text-sm font-bold text-[var(--foreground)]">{a.title}</div>
                      {a.relatedProjectCode && <div className="text-[11px] text-[var(--muted-foreground)]">{a.relatedProjectCode}</div>}
                    </td>
                    <td><StatusBadge tone={ANN_TYPE_TONE[a.type] ?? 'gray'}>{TYPE_LABELS[a.type] ?? '公告'}</StatusBadge></td>
                    <td>
                      <StatusBadge tone={wasScheduled ? 'blue' : from === 'PUBLISHED' ? 'green' : 'gray'}>
                        {wasScheduled ? '待发布' : FROM_STATUS_LABELS[from] ?? '草稿'}
                      </StatusBadge>
                    </td>
                    <td className="text-xs tabular-nums text-[var(--muted-foreground)]">{rc?.at ? new Date(rc.at).toLocaleString('zh-CN') : '—'}</td>
                    <td className="text-xs text-[var(--muted-foreground)]">{rc?.by ?? '—'}</td>
                    <td>
                      <div className="flex flex-nowrap justify-center gap-1.5">
                        <button onClick={() => setView({ id: a.id, title: a.title })} className="neu-btn-xs"><ExternalLink size={12} /> 查看</button>
                        <button onClick={() => restore(a)} className="neu-btn-xs is-success"><RotateCcw size={12} /> 恢复</button>
                        <button onClick={() => remove(a)} className="neu-btn-xs is-danger"><Trash2 size={12} /> 删除</button>
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
          description="公告详情（回收站内查看；恢复或永久删除请回到回收站列表操作）"
          size="4xl"
        >
          <iframe src={`/notice-view/${view.id}`} title={view.title} className="h-[74vh] w-full rounded-[12px] border-0 bg-white" />
        </Modal>
      )}
    </>
  );
}
