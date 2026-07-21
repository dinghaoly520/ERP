'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, UserRound, Loader2 } from 'lucide-react';
import { fetchChatUsers, getChatSocket, type ChatUser } from '@/lib/api/chat';
import { ROLE_LABELS } from '@/lib/role-labels';

interface MemberListDialogProps {
  onClose: () => void;
  onSelectPeer: (peerId: string) => void;
}

function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

export function MemberListDialog({ onClose, onSelectPeer }: MemberListDialogProps) {
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 初始拉用户列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChatUsers()
      .then((data) => {
        if (cancelled) return;
        setUsers(data);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 订阅 presence 增量
  useEffect(() => {
    const socket = getChatSocket();
    const onOnline = ({ userId }: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isOnline: true } : u)));
    };
    const onOffline = ({ userId }: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isOnline: false } : u)));
    };
    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    return () => {
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
    };
  }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.department?.name ?? '').toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q),
    );
  }, [users, query]);

  const onlineCount = users.filter((u) => u.isOnline).length;

  if (!mounted) return null;

  return createPortal(
    <div className="chat-overlay" onClick={onClose}>
      <div
        className="chat-window"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)' }}
      >
        {/* Header */}
        <div className="chat-header">
          <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-[12px]">
            <UserRound size={16} className="text-[color:var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold tracking-[-0.02em] text-[color:var(--foreground)]">
              人员列表
            </div>
            <div className="text-[11px] text-[color:var(--muted-foreground)]">
              共 {users.length} 人 · 在线 {onlineCount} 人 · 双击进入聊天
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs">
            <X size={15} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="search-box">
            <Search size={14} className="search-box__icon" />
            <input
              className="neu-input"
              placeholder="搜索姓名 / 用户名 / 部门"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="chat-empty">
              <Loader2 size={20} className="animate-spin" />
              正在加载...
            </div>
          ) : error ? (
            <div className="chat-empty">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="chat-empty">没有匹配的人员</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((u) => (
                <div
                  key={u.id}
                  className="chat-row"
                  onDoubleClick={() => onSelectPeer(u.id)}
                  title="双击进入聊天"
                >
                  <div className="relative">
                    {u.avatar ? (
                      <div className="chat-avatar h-10 w-10">
                        <img
                          src={u.avatar}
                          alt={u.displayName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="chat-avatar h-10 w-10">
                        <UserRound size={18} />
                      </div>
                    )}
                    <span
                      className={`chat-presence-dot absolute -right-0.5 -bottom-0.5 ${
                        u.isOnline ? 'chat-presence-dot--online' : 'chat-presence-dot--offline'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-[color:var(--foreground)] truncate">
                        {u.displayName}
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-[6px] shrink-0"
                        style={{
                          backgroundColor: 'var(--accent-tint)',
                          color: 'var(--accent-strong)',
                        }}
                      >
                        {roleLabel(u.role)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[color:var(--muted-foreground)] truncate">
                      {u.department?.name ?? '未设置部门'}
                    </div>
                  </div>
                  <div
                    className="text-[10.5px] font-semibold shrink-0"
                    style={{
                      color: u.isOnline ? 'var(--success)' : 'var(--muted-foreground)',
                    }}
                  >
                    {u.isOnline ? '在线' : '离线'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
