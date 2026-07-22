'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  ListTodo,
  PlayCircle,
  CalendarDays,
  AlertTriangle,
  ArrowUpRight,
  FolderKanban,
  Inbox,
  Loader2,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
  type WorkArrangementStatus,
  type WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';
import type { WorkbenchStatKey } from '@/lib/work-arrangements/workbench';
import {
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from '@/lib/api/notification';

type WorkStatKey = Exclude<WorkbenchStatKey, 'notif'>;

const URGENCY_RANK: Record<WorkArrangementUrgency, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const urgencyStyles: Record<WorkArrangementUrgency, string> = {
  CRITICAL: 'bg-[rgba(239,68,68,0.12)] text-[rgba(239,68,68,1)] border-[rgba(239,68,68,0.25)]',
  HIGH: 'bg-[rgba(249,115,22,0.12)] text-[rgba(249,115,22,1)] border-[rgba(249,115,22,0.25)]',
  MEDIUM: 'bg-[rgba(234,179,8,0.12)] text-[rgba(202,138,4,1)] border-[rgba(234,179,8,0.25)]',
  LOW: 'bg-[rgba(140,140,140,0.1)] text-[rgba(140,140,140,0.9)] border-[rgba(140,140,140,0.2)]',
};

const statusStyles: Record<WorkArrangementStatus, { chip: string; dot: string }> = {
  TODO: { chip: 'bg-[rgba(140,140,140,0.12)] text-[rgba(140,140,140,1)] border-[rgba(140,140,140,0.25)]', dot: 'rgba(140,140,140,1)' },
  IN_PROGRESS: { chip: 'bg-[rgba(96,139,239,0.12)] text-[rgba(96,139,239,1)] border-[rgba(96,139,239,0.25)]', dot: 'rgba(96,139,239,1)' },
  BLOCKED: { chip: 'bg-[rgba(230,129,102,0.12)] text-[rgba(230,129,102,1)] border-[rgba(230,129,102,0.25)]', dot: 'rgba(230,129,102,1)' },
  COMPLETED: { chip: 'bg-[rgba(92,181,150,0.12)] text-[rgba(92,181,150,1)] border-[rgba(92,181,150,0.25)]', dot: 'rgba(92,181,150,1)' },
  CANCELLED: { chip: 'bg-[rgba(140,140,140,0.12)] text-[rgba(140,140,140,0.8)] border-[rgba(140,140,140,0.25)]', dot: 'rgba(140,140,140,0.8)' },
};

const META: Record<
  WorkbenchStatKey,
  { title: string; empty: string; color: string; icon: typeof ListTodo }
> = {
  notif: { title: '通知待办', empty: '暂无待处理通知', color: '#7c3aed', icon: Bell },
  todo: { title: '工作待办', empty: '没有待处理的任务，干得漂亮', color: '#6366f1', icon: ListTodo },
  inProgress: { title: '进行中', empty: '当前没有进行中的任务', color: '#0ea5e9', icon: PlayCircle },
  dueToday: { title: '今日到期', empty: '今天没有到期的任务', color: '#f59e0b', icon: CalendarDays },
  risk: { title: '需注意', empty: '没有受阻或逾期的任务', color: '#ef4444', icon: AlertTriangle },
};

function formatDue(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatWhen(value: string): string {
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(d);
}

function sortTasks(items: WorkArrangementItem[]): WorkArrangementItem[] {
  return [...items].sort((a, b) => {
    const ua = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (ua !== 0) return ua;
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return da - db;
  });
}

function TaskRow({
  item,
  onView,
}: {
  item: WorkArrangementItem;
  onView: (id: string) => void;
}) {
  const status = statusStyles[item.status];
  const due = formatDue(item.dueAt);
  return (
    <div className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[var(--accent-soft)]/40">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: status.dot, boxShadow: `0 0 0 1px ${status.dot}` }}
        />
        <span className="min-w-0 flex-1 text-[13px] font-bold leading-snug text-[#18243a]">
          {item.title}
        </span>
        <button
          type="button"
          onClick={() => onView(item.id)}
          className="neu-btn-xs shrink-0"
        >
          <ArrowUpRight size={11} />
          <span>查看</span>
        </button>
      </div>
      <div className="ml-4.5 flex flex-wrap items-center gap-1.5">
        {item.projectManagementItem && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(96,139,239,0.1)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">
            <FolderKanban size={10} />
            <span className="max-w-[180px] truncate">{item.projectManagementItem.title}</span>
          </span>
        )}
        {due && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(245,158,11,0.1)] px-2 py-0.5 text-[11px] font-medium text-[rgba(180,120,10,1)]">
            <CalendarDays size={10} />
            {due}
          </span>
        )}
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${urgencyStyles[item.urgency]}`}>
          {WORK_ARRANGEMENT_URGENCY_LABELS[item.urgency]}
        </span>
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${status.chip}`}>
          {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
        </span>
      </div>
    </div>
  );
}

function NotifRow({ item }: { item: NotificationItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!item.isRead) await markNotificationRead(item.id);
      if (item.link) router.push(item.link);
    } catch {
      /* 标记已读失败不阻塞跳转 */
      if (item.link) router.push(item.link);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--accent-soft)]/40"
    >
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: item.isRead ? 'rgba(140,140,140,0.4)' : '#7c3aed', boxShadow: item.isRead ? 'none' : '0 0 0 3px rgba(124,58,237,0.15)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-[#18243a]">{item.title}</span>
        {item.content && (
          <span className="mt-0.5 block truncate text-[11.5px] text-[color:var(--muted-foreground)]">{item.content}</span>
        )}
        <span className="mt-1 block text-[10.5px] text-[color:var(--muted-foreground)]">{formatWhen(item.createdAt)}</span>
      </span>
      {item.link && <ArrowUpRight size={13} className="mt-1 shrink-0 text-[color:var(--muted-foreground)]" />}
    </button>
  );
}

interface WorkbenchStatDialogProps {
  openKey: WorkbenchStatKey | null;
  onClose: () => void;
  /** 四类工作统计的真实任务列表，须与标题栏计数同源同谓词 */
  workItems: Record<WorkStatKey, WorkArrangementItem[]>;
  onSelectTask: (id: string) => void;
}

export function WorkbenchStatDialog({
  openKey,
  onClose,
  workItems,
  onSelectTask,
}: WorkbenchStatDialogProps) {
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  // 打开「通知待办」时拉真实通知列表
  useEffect(() => {
    if (openKey !== 'notif') return;
    let cancelled = false;
    setNotifLoading(true);
    listNotifications('all', 1, 50)
      .then((res) => {
        if (cancelled) return;
        setNotifs(res.items);
        setNotifTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) {
          setNotifs([]);
          setNotifTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setNotifLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openKey]);

  const sortedWork = useMemo(
    () => (openKey && openKey !== 'notif' ? sortTasks(workItems[openKey]) : []),
    [openKey, workItems],
  );

  // 关闭态：hooks 已执行完毕，安全提前返回，避免对 null 的 meta 取值
  if (openKey === null) return null;

  const meta = META[openKey];
  const Icon = meta.icon;
  const workCount = openKey !== 'notif' ? workItems[openKey].length : 0;

  const description =
    openKey === 'notif'
      ? notifLoading
        ? '正在加载通知…'
        : `共 ${notifTotal} 条${notifTotal > 50 ? '，显示最近 50 条' : ''}`
      : `共 ${workCount} 项 · 数据来自当前工作安排`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2.5">
          <Icon size={18} style={{ color: meta.color }} />
          {meta.title}
        </span>
      }
      description={description}
    >
      {openKey === 'notif' ? (
        notifLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[color:var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            正在加载通知…
          </div>
        ) : notifs.length === 0 ? (
          <EmptyState text={meta.empty} />
        ) : (
          <div className="-mx-2 max-h-[52vh] overflow-y-auto divide-y divide-[#eef3f8]">
            {notifs.map((n) => (
              <NotifRow key={n.id} item={n} />
            ))}
          </div>
        )
      ) : sortedWork.length === 0 ? (
        <EmptyState text={meta.empty} />
      ) : (
        <div className="-mx-2 max-h-[52vh] overflow-y-auto divide-y divide-[#eef3f8]">
          {sortedWork.map((item) => (
            <TaskRow key={item.id} item={item} onView={onSelectTask} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-2xl">
        <Inbox size={20} strokeWidth={1.4} className="text-[color:var(--muted-foreground)]" />
      </div>
      <span className="text-[13px] text-[color:var(--muted-foreground)]">{text}</span>
    </div>
  );
}
