'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, X, UserRound, Send, Image as ImageIcon, Paperclip,
  Loader2, FileText, Download, NotebookPen,
} from 'lucide-react';
import {
  fetchChatUsers, fetchMessages, markRead, uploadChatFile, getChatSocket,
  type ChatMessage, type ChatUser,
} from '@/lib/api/chat';
import { ROLE_LABELS } from '@/lib/role-labels';

interface ChatDialogProps {
  peerId: string;
  onClose: () => void;
  onBack: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

interface SendPayload {
  type: 'text' | 'image' | 'file';
  content: string;
  fileAssetId?: string;
  fileUrl?: string;
  fileMime?: string;
  fileSize?: number;
}

export function ChatDialog({ peerId, onClose, onBack }: ChatDialogProps) {
  const [meId, setMeId] = useState<string | null>(null);
  const [peer, setPeer] = useState<ChatUser | null>(null);
  const [peerOnline, setPeerOnline] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<'image' | 'file' | null>(null);
  const [mounted, setMounted] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<ReturnType<typeof getChatSocket> | null>(null);

  useEffect(() => setMounted(true), []);

  // 拉当前用户 + peer 信息
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json() as Promise<{ id: string }>),
      fetchChatUsers(),
    ])
      .then(([me, users]) => {
        if (cancelled) return;
        setMeId(me.id);
        const p = users.find((u) => u.id === peerId);
        if (p) {
          setPeer(p);
          setPeerOnline(p.isOnline);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [peerId]);

  // 拉历史消息
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMessages(peerId)
      .then((data) => {
        if (cancelled) return;
        setMessages(data);
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
  }, [peerId]);

  // 打开即标记已读一次
  useEffect(() => {
    if (!meId) return;
    void markRead(peerId).catch(() => {});
    const socket = getChatSocket();
    socket.emit('message:read', { peerId });
  }, [meId, peerId]);

  // 订阅实时事件
  useEffect(() => {
    const socket = getChatSocket();
    socketRef.current = socket;

    const onNew = (msg: ChatMessage) => {
      // 只处理当前会话的消息
      const otherParty = msg.senderId === meId ? msg.receiverId : msg.senderId;
      if (otherParty !== peerId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      // 对方刚发来的 → 当前正在看，立即标记已读
      if (msg.senderId === peerId && meId) {
        void markRead(peerId).catch(() => {});
        socket.emit('message:read', { peerId });
      }
    };
    const onRead = ({ by }: { by: string; updated: number }) => {
      if (by !== peerId) return;
      const nowIso = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.senderId === meId && m.receiverId === peerId && !m.readAt ? { ...m, readAt: nowIso } : m,
        ),
      );
    };
    const onOnline = ({ userId }: { userId: string }) => {
      if (userId === peerId) setPeerOnline(true);
    };
    const onOffline = ({ userId }: { userId: string }) => {
      if (userId === peerId) setPeerOnline(false);
    };

    socket.on('message:new', onNew);
    socket.on('message:read', onRead);
    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:read', onRead);
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
    };
  }, [peerId, meId]);

  // 滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ESC：先关 lightbox，再关弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightbox]);

  const doSend = useCallback(
    (payload: SendPayload) =>
      new Promise<void>((resolve) => {
        const socket = socketRef.current ?? getChatSocket();
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        socket.emit('message:send', { receiverId: peerId, ...payload }, (ack: any) => {
          if (ack?.ok && ack.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === ack.message.id) ? prev : [...prev, ack.message],
            );
          }
          finish();
        });
        // 超时兜底，避免 ack 丢失导致 sending 卡住
        setTimeout(finish, 5000);
      }),
    [peerId],
  );

  const handleSendText = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      await doSend({ type: 'text', content: text });
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (file: File, kind: 'image' | 'file') => {
    setUploadingKind(kind);
    try {
      const uploaded = await uploadChatFile(file);
      await doSend({
        type: kind,
        content: uploaded.originalName,
        fileAssetId: uploaded.id,
        fileUrl: uploaded.url,
        fileMime: uploaded.mimeType,
        fileSize: uploaded.size,
      });
    } finally {
      setUploadingKind(null);
    }
  };

  if (!mounted) return null;

  // 自我留言（资料备份）模式：peerId === meId
  const isSelfMode = meId !== null && peerId === meId;

  return createPortal(
    <div className="chat-overlay" onClick={onClose}>
      <div
        className="chat-window"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', height: 'min(640px, 88vh)' }}
      >
        {/* Header */}
        <div className="chat-header">
          <button type="button" onClick={onBack} className="neu-btn-xs" title="返回人员列表">
            <ArrowLeft size={15} />
          </button>
          <div className="relative">
            {peer?.avatar ? (
              <div className="chat-avatar h-10 w-10">
                <img src={peer.avatar} alt={peer.displayName} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="chat-avatar h-10 w-10">
                <UserRound size={18} />
              </div>
            )}
            <span
              className={`chat-presence-dot absolute -right-0.5 -bottom-0.5 ${
                peerOnline ? 'chat-presence-dot--online' : 'chat-presence-dot--offline'
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold tracking-[-0.02em] text-[color:var(--foreground)] truncate">
                {isSelfMode ? '资料备份' : (peer?.displayName ?? '加载中...')}
              </span>
              {isSelfMode ? (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[6px] shrink-0"
                  style={{ backgroundColor: 'var(--accent-tint)', color: 'var(--accent-strong)' }}
                >
                  <NotebookPen size={10} strokeWidth={1.8} />私人
                </span>
              ) : peer && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-[6px] shrink-0"
                  style={{ backgroundColor: 'var(--accent-tint)', color: 'var(--accent-strong)' }}
                >
                  {roleLabel(peer.role)}
                </span>
              )}
            </div>
            <div
              className="text-[11px]"
              style={{ color: isSelfMode ? 'var(--muted-foreground)' : (peerOnline ? 'var(--success)' : 'var(--muted-foreground)') }}
            >
              {isSelfMode
                ? '单方面写入，不期待回复 · 用于备忘与资料归档'
                : `${peerOnline ? '在线' : '离线'}${peer?.department?.name ? ` · ${peer.department.name}` : ''}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs">
            <X size={15} />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5">
          {loading ? (
            <div className="chat-empty">
              <Loader2 size={20} className="animate-spin" />
              正在加载消息...
            </div>
          ) : error ? (
            <div className="chat-empty">{error}</div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              {isSelfMode ? (
                <>
                  <NotebookPen size={28} strokeWidth={1.4} className="text-[color:var(--accent)]" />
                  这里是你的私人备忘录
                  <span className="mt-1 text-[10px] text-[color:var(--muted-foreground)]/70">
                    发送文字 / 图片 / 文件，作为资料备份留存
                  </span>
                </>
              ) : (
                <>
                  <UserRound size={28} strokeWidth={1.4} />
                  还没有消息，发送一条打个招呼吧
                </>
              )}
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.senderId === meId;
              const bubbleCls = `chat-bubble ${isMe ? 'chat-bubble-me' : 'chat-bubble-peer'}`;
              return (
                <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {m.type === 'text' && <div className={bubbleCls}>{m.content}</div>}

                  {m.type === 'image' && (
                    <div className={`${bubbleCls} chat-bubble--media`}>
                      <div
                        className="chat-msg-image"
                        onClick={() => m.fileUrl && setLightbox(m.fileUrl)}
                      >
                        <img src={m.fileUrl ?? ''} alt={m.content} />
                      </div>
                    </div>
                  )}

                  {m.type === 'file' && (
                    <div className={`${bubbleCls} chat-bubble--media`}>
                      <a
                        className="chat-msg-file"
                        href={m.fileUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-[10px]">
                          <FileText size={16} />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-semibold truncate">{m.content}</span>
                          <span className="text-[10px] opacity-70">{formatSize(m.fileSize)}</span>
                        </div>
                        <Download size={14} className="ml-1 opacity-60" />
                      </a>
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-1.5 px-1">
                    <span className="text-[10px] text-[color:var(--muted-foreground)]">
                      {formatTime(m.createdAt)}
                    </span>
                    {isMe && !isSelfMode && <span className="chat-read-mark">{m.readAt ? '已读' : '未读'}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input */}
        <div className="px-3 pb-3">
          <div className="chat-input-bar">
            <button
              type="button"
              className={`chat-input-icon ${uploadingKind ? 'is-disabled' : ''}`}
              onClick={() => imageInputRef.current?.click()}
              disabled={!!uploadingKind}
              title="发送图片"
            >
              {uploadingKind === 'image' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ImageIcon size={16} />
              )}
            </button>
            <button
              type="button"
              className={`chat-input-icon ${uploadingKind ? 'is-disabled' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploadingKind}
              title="发送文件"
            >
              {uploadingKind === 'file' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Paperclip size={16} />
              )}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendText();
                }
              }}
              placeholder={isSelfMode ? '写下要备份的内容，Enter 保存 / Shift+Enter 换行' : '输入消息，Enter 发送 / Shift+Enter 换行'}
              rows={1}
            />
            <button
              type="button"
              className="chat-input-icon"
              onClick={() => void handleSendText()}
              disabled={!input.trim() || sending}
              title="发送"
              style={{ color: input.trim() ? 'var(--accent-strong)' : undefined }}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f, 'image');
              e.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f, 'file');
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-[92vh] max-w-[92vw] rounded-[12px]" />
        </div>
      )}
    </div>,
    document.body,
  );
}
