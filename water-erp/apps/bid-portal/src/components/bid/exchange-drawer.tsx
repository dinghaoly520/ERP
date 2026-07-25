'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openingHallApi } from '@/lib/opening-hall';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import type {
  HallMessagePayload,
  HallPresenceUpdatePayload,
  HallCheckinPayload,
  HallExchangeControlPayload,
} from '@water-erp/shared';

type Msg = { id: string; senderRole: string; senderName: string; content: string; createdAt: string };
type Session = { supplierId: string; supplierName: string; checkInAt: string | null; unread: number };

export function ExchangeDrawer({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [activeSupplier, setActiveSupplier] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [publicMsgs, setPublicMsgs] = useState<Msg[]>([]);
  const [privateMsgs, setPrivateMsgs] = useState<Msg[]>([]);
  const [publicUnread, setPublicUnread] = useState(0);
  const [roster, setRoster] = useState<HallPresenceUpdatePayload['onlineSuppliers']>([]);
  const [control, setControl] = useState<'OPEN' | 'MUTED' | 'CLOSED'>('OPEN');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [checkins, setCheckins] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const toMsg = (d: HallMessagePayload): Msg => ({
    id: d.id, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt,
  });
  const activeSupplierRef = useRef<string | null>(null);
  activeSupplierRef.current = activeSupplier?.supplierId ?? null;
  // tabRef：事件回调内读当前 tab（避免在 setTab 更新器里做副作用——StrictMode/并发双调会重复计数）
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useBidWebSocket(projectId, {
    onHallMessage: useCallback((d: HallMessagePayload) => {
      if (d.roomType === 'PUBLIC') {
        setPublicMsgs(prev => { const exists = prev.some(m => m.id === d.id); return exists ? prev : [...prev, toMsg(d)]; });
        if (tabRef.current !== 'PUBLIC') setPublicUnread(n => n + 1);
      } else {
        setPrivateMsgs(prev => (d.supplierId === activeSupplierRef.current ? [...prev, toMsg(d)] : prev));
        setSessions(prev => prev.map(s =>
          s.supplierId === d.supplierId && d.supplierId !== activeSupplierRef.current
            ? { ...s, unread: s.unread + 1 } : s));
      }
    }, []),
    onHallPresence: useCallback((d: HallPresenceUpdatePayload) => setRoster(d.onlineSuppliers), []),
    onHallCheckin: useCallback((d: HallCheckinPayload) => setCheckins(prev => ({ ...prev, [d.supplierId]: d.checkInAt })), []),
    onHallExchangeControl: useCallback((d: HallExchangeControlPayload) => setControl(d.control), []),
  });

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [publicMsgs, privateMsgs, tab]);

  useEffect(() => {
    if (!open) return;
    openingHallApi.messages(projectId, { roomType: 'PUBLIC', limit: 100 })
      .then(r => setPublicMsgs(prev => {
        // 按 id 合并，避免覆盖 hydrate 请求在途期间到达的 socket 增量
        const fresh = prev.filter(m => !r.items.some((i: any) => i.id === m.id));
        return [...r.items.map(toMsg), ...fresh];
      })).catch(() => {});
    openingHallApi.unread(projectId).then(r => {
      setPublicUnread(r.public ?? 0);
      setSessions(r.sessions ?? []);
    }).catch(() => {});
    openingHallApi.presence(projectId).then(r => {
      setRoster((r.suppliers ?? []).filter((s: any) => s.online).map((s: any) => ({
        supplierId: s.supplierId, supplierName: s.supplierName, checkInAt: s.checkInAt ? String(s.checkInAt) : null,
      })));
    }).catch(() => {});
  }, [open, projectId]);

  async function openPrivate(s: Session) {
    // 同步写 ref：消除点击到重渲染之间 activeSupplierRef 的旧值窗口
    activeSupplierRef.current = s.supplierId;
    setActiveSupplier(s); setTab('PRIVATE');
    // 切换供应商：先同步清空上一家的消息（同 tick 内无 socket 事件可插入），
    // hydrate 返回后再按 id 合并，保留请求在途期间到达的 socket 增量
    setPrivateMsgs([]);
    setSessions(prev => prev.map(x => (x.supplierId === s.supplierId ? { ...x, unread: 0 } : x)));
    const r = await openingHallApi.messages(projectId, { roomType: 'PRIVATE', supplierId: s.supplierId, limit: 100 }).catch(() => null);
    setPrivateMsgs(prev => {
      if (!r) return prev;
      // 陈旧响应守卫：快速切换 A→B→C 且 B 请求晚归时，丢弃 B 的响应，不污染 C 的会话
      if (activeSupplierRef.current !== s.supplierId) return prev;
      const fresh = prev.filter(m => !r.items.some((i: any) => i.id === m.id));
      return [...r.items.map(toMsg), ...fresh];
    });
    await openingHallApi.markRead(projectId, `supplier:${s.supplierId}`).catch(() => {});
  }

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    if (tab === 'PRIVATE' && !activeSupplier) return;
    setSending(true);
    try {
      await openingHallApi.send(projectId, {
        roomType: tab,
        supplierId: tab === 'PRIVATE' ? activeSupplier!.supplierId : undefined,
        content,
      });
      setInput('');
    } catch (e: any) {
      alert(e?.message || '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function changeControl(next: 'OPEN' | 'MUTED' | 'CLOSED') {
    try {
      await openingHallApi.setControl(projectId, next);
      setControl(next);
    } catch (e: any) {
      alert(e?.message || '切换失败');
    }
  }

  const msgs = tab === 'PUBLIC' ? publicMsgs : privateMsgs;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative rounded-xl border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        会场交流
        {(publicUnread > 0 || sessions.some(s => s.unread > 0)) && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white">
            {publicUnread + sessions.reduce((a, s) => a + s.unread, 0)}
          </span>
        )}
      </button>

      {/* C2：抽屉经 portal 渲染到 body——SectionCard（glass-card）的 backdrop-filter 会为 fixed 后代
          建立包含块并被 overflow-hidden 裁剪；portal 化后 fixed 相对视口定位。
          抽屉仅在 open（客户端 state）为 true 时渲染，SSR 不触碰 document。
          层级：抽屉 z-40 低于唱标录入模态 z-50 ✓ */}
      {/* 抽屉 top-[68px] 避开 app-shell sticky 页头（z-50 h-[68px]），否则头部控制行被遮挡不可点 */}
      {open && createPortal(
        <aside className="fixed right-0 top-[68px] z-40 flex h-[calc(100%-68px)] w-[420px] flex-col border-l border-slate-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">会场交流</h3>
            <div className="flex items-center gap-1 text-xs">
              {(['OPEN', 'MUTED', 'CLOSED'] as const).map(c => (
                <button key={c} onClick={() => changeControl(c)}
                  className={`rounded-lg px-2 py-1 ${control === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {c === 'OPEN' ? '开放' : c === 'MUTED' ? '禁言' : '关闭'}
                </button>
              ))}
              <button onClick={() => setOpen(false)} className="ml-2 text-slate-400 hover:text-slate-700">✕</button>
            </div>
          </header>

          <div className="border-b border-slate-200 px-4 py-2">
            <div className="mb-1 text-xs font-medium text-slate-500">在场名单（{roster.length}）</div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map(s => (
                <span key={s.supplierId} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  {s.supplierName}{s.checkInAt || checkins[s.supplierId] ? ' ✓签到' : ''}
                </span>
              ))}
              {roster.length === 0 && <span className="text-xs text-slate-400">暂无供应商在线</span>}
            </div>
          </div>

          <div className="flex gap-2 border-b border-slate-200 px-4 py-2 text-sm">
            <button onClick={() => { setTab('PUBLIC'); setPublicUnread(0); openingHallApi.markRead(projectId, 'public').catch(() => {}); }}
              className={tab === 'PUBLIC' ? 'font-semibold text-slate-900' : 'text-slate-500'}>
              公聊{publicUnread > 0 ? ` (${publicUnread})` : ''}
            </button>
            <button onClick={() => setTab('PRIVATE')}
              className={tab === 'PRIVATE' ? 'font-semibold text-slate-900' : 'text-slate-500'}>
              私聊
            </button>
          </div>

          {tab === 'PRIVATE' && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-slate-200 px-4 py-2">
              {sessions.map(s => (
                <button key={s.supplierId} onClick={() => openPrivate(s)}
                  className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs ${activeSupplier?.supplierId === s.supplierId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {s.supplierName}{s.unread > 0 ? ` ●${s.unread}` : ''}
                </button>
              ))}
              {sessions.length === 0 && <span className="text-xs text-slate-400">暂无供应商参与</span>}
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {tab === 'PRIVATE' && !activeSupplier && <div className="pt-10 text-center text-xs text-slate-400">选择一家供应商开始私聊</div>}
            {msgs.map(m => (
              <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.senderRole === 'HOST' ? 'bg-slate-100' : m.senderRole === 'SYSTEM' ? 'bg-transparent text-center text-xs text-slate-400' : 'bg-blue-50'}`}>
                <div className="mb-0.5 text-[11px] text-slate-400">{m.senderName} · {new Date(m.createdAt).toLocaleTimeString('zh-CN')}</div>
                <div className="whitespace-pre-wrap break-all">{m.content}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) send(); }}
              placeholder={tab === 'PRIVATE' && !activeSupplier ? '请先选择供应商' : '输入消息（Enter 发送）'}
              disabled={tab === 'PRIVATE' && !activeSupplier}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
            />
            <button onClick={send} disabled={sending || !input.trim()}
              className="rounded-xl bg-slate-900 px-4 text-sm text-white disabled:opacity-40">发送</button>
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
