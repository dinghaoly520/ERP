'use client';

import { useEffect, useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { assignBidHost, listBidHosts } from '@/lib/api/bid';

type Host = { id: string; username: string; displayName: string };

type Props = {
  projectId: string;
  currentHostId: string | null;
  onClose: () => void;
  onChanged: (host: Host | null) => void;
};

export function HostPickerModal({ projectId, currentHostId, onClose, onChanged }: Props) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selected, setSelected] = useState<string | null>(currentHostId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBidHosts()
      .then(setHosts)
      .catch(() => setError('加载主持人列表失败'));
  }, []);

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
      else if (code === 'INVALID_HOST') setError('目标用户不是有效的主持人');
      else setError('指派失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center px-6"
      style={{ background: 'oklch(0.975 0.012 258 / 0.5)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-full max-w-[380px] rounded-[20px] px-6 py-5"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-[10px]"
            style={{
              background: 'var(--stage-evaluation-soft)',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)',
            }}
          >
            <UserCheck size={15} style={{ color: 'var(--stage-evaluation)' }} />
          </div>
          <span className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">指派开标主持人</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)]"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <p className="mb-3 text-xs leading-5 text-[var(--muted-foreground)]">
          指派后，该项目仅在 :3007 开评标管理端对<span className="font-semibold">被指派的主持人</span>可见；其它主持人看不到。
        </p>

        <div className="mb-4 max-h-[260px] space-y-1.5 overflow-y-auto">
          <label
            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
            style={{ border: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
          >
            <input
              type="radio"
              name="bid-host"
              className="accent-[var(--accent)]"
              checked={selected === null}
              onChange={() => setSelected(null)}
            />
            <span className="text-sm text-[var(--muted-foreground)]">清除指派（公开池，:3007 不可见）</span>
          </label>
          {hosts.map((h) => (
            <label
              key={h.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
              style={{ border: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
            >
              <input
                type="radio"
                name="bid-host"
                className="accent-[var(--accent)]"
                checked={selected === h.id}
                onChange={() => setSelected(h.id)}
              />
              <span className="text-sm text-[var(--foreground)]">{h.displayName}</span>
            </label>
          ))}
        </div>

        {error && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-xs font-medium text-[var(--danger)]"
            style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="neu-btn-soft !h-[36px] !text-xs">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="neu-btn-primary !h-[36px] !text-xs"
          >
            <UserCheck size={13} /> 确认指派
          </button>
        </div>
      </div>
    </div>
  );
}
