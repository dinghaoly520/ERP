'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { UserCheck } from 'lucide-react';
import { assignBidHost, listBidHosts } from '@/lib/api/bid';
import { ROLE_LABELS } from '@/lib/role-labels';
import type { AuthRole } from '@/lib/api/auth';
import { Modal } from '@/components/workbench';

type HostCandidate = { id: string; username: string; displayName: string; role: string };

/** 角色 → 状态胶囊色调（wb-status-pill --tone）：主持=默认品牌蓝；领导/员工用中性区分 */
const ROLE_TONE: Partial<Record<string, string>> = {
  bid_host: undefined, // 缺省 tone = var(--accent)
  leader: 'var(--success)',
  staff: 'var(--muted-foreground)',
};

function RolePill({ role }: { role: string }) {
  const tone = ROLE_TONE[role];
  return (
    <span className="wb-status-pill" style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}>
      {ROLE_LABELS[role as AuthRole] ?? role}
    </span>
  );
}

type Props = {
  projectId: string;
  currentHostId: string | null;
  /** 被指派人姓名（脱靶提示用；与 currentHostId 同源，来自面板 detail.assignedHostUser） */
  currentHostName?: string | null;
  onClose: () => void;
  onChanged: (host: { id: string; displayName: string } | null) => void;
};

export function HostPickerModal({ projectId, currentHostId, currentHostName, onClose, onChanged }: Props) {
  const [hosts, setHosts] = useState<HostCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(currentHostId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBidHosts(projectId)
      .then(setHosts)
      .catch(() => setError('加载主持人列表失败'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // 脱靶：已指派但被指派人不在候选集（冻结/停用/调离本公司）——radio 无预选，此行解释缘由
  const orphaned = !loading && !!currentHostId && !!currentHostName && !hosts.some((h) => h.id === currentHostId);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await assignBidHost(projectId, selected);
      onChanged(res.assignedHostUser ?? null);
      onClose();
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'OPENING_SESSION_LOCKED') setError('开标会话已组建，无法改派');
      else if (code === 'INVALID_HOST') setError('目标用户不是本项目公司内的有效主持人');
      else setError('指派失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2.5">
          <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]">
            <UserCheck size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
          </span>
          指派开标主持人
        </span>
      }
      footer={
        <div className="neu-btn-group">
          <button type="button" onClick={onClose} className="neu-btn-soft">取消</button>
          <button type="button" onClick={() => void handleSave()} disabled={busy} className="neu-btn-primary">
            <UserCheck size={13} /> 确认指派
          </button>
        </div>
      }
    >
      <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
        {orphaned && (
          <div className="wb-note px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
            当前指派：<span className="font-semibold text-[var(--foreground)]">{currentHostName}</span> —— 已不在候选范围，请改派
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] focus-within:ring-1 focus-within:ring-[color-mix(in_oklch,var(--accent)_30%,transparent)]">
          <input
            type="radio"
            name="bid-host"
            className="accent-[var(--accent)]"
            checked={selected === null}
            onChange={() => setSelected(null)}
          />
          <span className="text-sm text-[var(--muted-foreground)]">清除指派（暂无主持人，仅管理员可主持开标）</span>
        </label>
        {loading ? (
          <div className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
        ) : hosts.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">本公司暂无可指派人员</div>
        ) : (
          hosts.map((h) => (
            <label
              key={h.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] focus-within:ring-1 focus-within:ring-[color-mix(in_oklch,var(--accent)_30%,transparent)]"
            >
              <input
                type="radio"
                name="bid-host"
                className="accent-[var(--accent)]"
                checked={selected === h.id}
                onChange={() => setSelected(h.id)}
              />
              <span className="mr-auto text-sm text-[var(--foreground)]">{h.displayName}</span>
              <RolePill role={h.role} />
            </label>
          ))
        )}
      </div>

      {error && (
        <div className="wb-alert wb-alert--danger">
          {error}
        </div>
      )}
    </Modal>
  );
}
