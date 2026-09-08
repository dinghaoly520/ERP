'use client';

import { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { assignBidHost, listBidHosts } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

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
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="指派开标主持人"
      description={<>指派后，该项目仅在 :3007 开评标管理端对<span className="font-semibold">被指派的主持人</span>可见；其它主持人看不到。</>}
      footer={
        <div className="neu-btn-group">
          <button type="button" onClick={onClose} className="neu-btn-soft">取消</button>
          <button type="button" onClick={() => void handleSave()} disabled={busy} className="neu-btn-primary">
            <UserCheck size={13} /> 确认指派
          </button>
        </div>
      }
    >
      <div className="max-h-[260px] space-y-1.5 overflow-y-auto">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] focus-within:ring-1 focus-within:ring-[color-mix(in_oklch,var(--accent)_30%,transparent)]">
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
            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] focus-within:ring-1 focus-within:ring-[color-mix(in_oklch,var(--accent)_30%,transparent)]"
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
        <div className="wb-alert wb-alert--danger">
          {error}
        </div>
      )}
    </Modal>
  );
}
