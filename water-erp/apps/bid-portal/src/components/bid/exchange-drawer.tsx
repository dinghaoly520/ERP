'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { openingHallApi } from '@/lib/opening-hall';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import type {
  HallMessagePayload,
  HallPresenceUpdatePayload,
  HallCheckinPayload,
  HallExchangeControlPayload,
  StageChangePayload,
} from '@water-erp/shared';

type Msg = { id: string; senderRole: string; senderName: string; content: string; createdAt: string };
type Session = { supplierId: string; supplierName: string; checkInAt: string | null; unread: number };

export function ExchangeDrawer({ projectId, initialStageClosed }: { projectId: string; initialStageClosed?: boolean }) {
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
  // R4：stage:change 离开 OPENING 后关闭输入；Wave 5-6：初值由页面当前项目阶段同步
  // （纯事件驱动时，阶段已离 OPENING 后才开的抽屉初始仍可输入，首次发送撞 403）
  const [stageClosed, setStageClosed] = useState(initialStageClosed ?? false);
  const hydratedRef = useRef(false); // R3：本轮打开是否已首载（决定重连后是否补齐）
  const listRef = useRef<HTMLDivElement>(null);

  const toMsg = (d: HallMessagePayload): Msg => ({
    id: d.id, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt,
  });
  // 时间格式：当天仅显示时刻，跨天带月日（避免跨天消息时间歧义）
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString('zh-CN')
      : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const activeSupplierRef = useRef<string | null>(null);
  activeSupplierRef.current = activeSupplier?.supplierId ?? null;
  // tabRef：事件回调内读当前 tab（避免在 setTab 更新器里做副作用——StrictMode/并发双调会重复计数）
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // projectIdRef：hydrate 陈旧响应守卫（切项目后旧请求晚归时不再写回新项目的 state）
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const { connection, reconnectNow } = useBidWebSocket(projectId, {
    // R4：阶段离开 OPENING → 关闭 host 输入（大厅互动仅在开标阶段开放；MUTED 不影响 host 发言）
    onStageChange: useCallback((d: StageChangePayload) => {
      if (d.to && d.to !== 'OPENING') setStageClosed(true);
    }, []),
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

  /** 公聊历史/未读/花名册 + 私聊（若已选中供应商）一把拉齐。首开与 R3 重连补齐共用。 */
  const hydrate = useCallback(async () => {
    const [pub, unread, pres] = await Promise.allSettled([
      openingHallApi.messages(projectId, { roomType: 'PUBLIC', limit: 100 }),
      openingHallApi.unread(projectId),
      openingHallApi.presence(projectId),
    ]);
    // 陈旧响应守卫（I2）：切项目后本 hydrate（闭包旧 projectId）晚归时丢弃，不写回新项目 state
    if (projectIdRef.current !== projectId) return;
    let lastPublicId: string | undefined;
    if (pub.status === 'fulfilled') {
      lastPublicId = pub.value.items[pub.value.items.length - 1]?.id;
      setPublicMsgs(prev => {
        // 按 id 合并，避免覆盖 hydrate 请求在途期间到达的 socket 增量。
        // Wave 5-5：fresh 只保留比服务端窗口最新一条还新的本地消息（真在途增量）——消息超 100
        // 条重开抽屉时，窗口外的旧残留若追加尾部会造成尾部乱序且永不消除，故丢弃
        const items = pub.value.items;
        const maxIso = items[items.length - 1]?.createdAt;
        const fresh = prev.filter(m => !items.some((i: any) => i.id === m.id) && (!maxIso || m.createdAt > maxIso));
        return [...items.map(toMsg), ...fresh];
      });
    }
    if (unread.status === 'fulfilled') {
      setSessions(unread.value.sessions ?? []);
      // U2：默认停留 PUBLIC——未读即时清零（看的是公聊列表本身）
      setPublicUnread(tabRef.current === 'PUBLIC' ? 0 : (unread.value.public ?? 0));
    }
    if (pres.status === 'fulfilled') {
      setRoster((pres.value.suppliers ?? []).filter((s: any) => s.online).map((s: any) => ({
        supplierId: s.supplierId, supplierName: s.supplierName, checkInAt: s.checkInAt ? String(s.checkInAt) : null,
      })));
    }
    // 私聊：已选中供应商时补拉历史（同 openPrivate 的陈旧响应守卫）
    const sid = activeSupplierRef.current;
    let lastPrivateId: string | undefined;
    if (sid) {
      const r = await openingHallApi.messages(projectId, { roomType: 'PRIVATE', supplierId: sid, limit: 100 }).catch(() => null);
      if (r && projectIdRef.current === projectId) {
        lastPrivateId = r.items[r.items.length - 1]?.id;
        setPrivateMsgs(prev => {
          if (activeSupplierRef.current !== sid || projectIdRef.current !== projectId) return prev;
          // Wave 5-5：同公聊——只保留比服务端窗口最新一条还新的本地在途增量，丢弃窗口外旧残留
          const maxIso = r.items[r.items.length - 1]?.createdAt;
          const fresh = prev.filter(m => !r.items.some((i: any) => i.id === m.id) && (!maxIso || m.createdAt > maxIso));
          return [...r.items.map(toMsg), ...fresh];
        });
      }
    }
    if (projectIdRef.current !== projectId) return;
    // U2：hydrate 后对当前 tab 即时 markRead，游标定在已加载末条（在途消息不被 now() 误判已读）
    if (tabRef.current === 'PUBLIC') {
      openingHallApi.markRead(projectId, 'public', lastPublicId).catch(() => {});
    } else if (sid) {
      openingHallApi.markRead(projectId, `supplier:${sid}`, lastPrivateId).catch(() => {});
    }
  }, [projectId]);

  // 首次 open 立即 hydrate；其后仅重连回 connected 时重跑补齐断线窗口（R3）
  useEffect(() => {
    if (!open) { hydratedRef.current = false; return; }
    if (!hydratedRef.current) { hydratedRef.current = true; hydrate(); }
    else if (connection === 'connected') { hydrate(); }
  }, [open, projectId, connection, hydrate]);

  // U8：切换项目时重置抽屉全部状态，避免跨项目数据串档
  useEffect(() => {
    activeSupplierRef.current = null;
    setActiveSupplier(null);
    setPrivateMsgs([]);
    setPublicMsgs([]);
    setSessions([]);
    setPublicUnread(0);
    setTab('PUBLIC');
    setCheckins({});
    setRoster([]);
    setStageClosed(initialStageClosed ?? false);
    setControl('OPEN'); // M1：避免 A 项目的 CLOSED 串到 B 项目（control 无 REST 来源，仅事件驱动）
    setInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切项目时以新项目阶段初值复位；initialStageClosed 的后续变化由下方只升不降的 effect 接管
  }, [projectId]);

  // Wave 5-6：prop 初值同步——stageClosed 原纯事件驱动，阶段已离 OPENING 后才开的抽屉初始仍可输入。
  // 声明在切项目复位 effect 之后：同一 commit 内复位先跑、同步后跑，最终值正确。
  // 只升不降：事件已置 true 后不被 prop 回退（阶段不会倒流，防御 prop 闪变）
  useEffect(() => {
    setStageClosed(prev => prev || (initialStageClosed ?? false));
  }, [initialStageClosed]);

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
      // Wave 5-5：同公聊——只保留比服务端窗口最新一条还新的本地在途增量，丢弃窗口外旧残留
      const maxIso = r.items[r.items.length - 1]?.createdAt;
      const fresh = prev.filter(m => !r.items.some((i: any) => i.id === m.id) && (!maxIso || m.createdAt > maxIso));
      return [...r.items.map(toMsg), ...fresh];
    });
    await openingHallApi.markRead(projectId, `supplier:${s.supplierId}`, r?.items?.[r.items.length - 1]?.id).catch(() => {});
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
      // U9：alert → sonner toast（页面级 Toaster 已挂载）
      toast.error(e?.message || '操作失败');
    } finally {
      setSending(false);
    }
  }

  async function changeControl(next: 'OPEN' | 'MUTED' | 'CLOSED') {
    try {
      await openingHallApi.setControl(projectId, next);
      setControl(next);
    } catch (e: any) {
      // U9：alert → sonner toast
      toast.error(e?.message || '操作失败');
    }
  }

  // 私聊 tab 归并公聊里的 SYSTEM 控制提示（交流控制变更落 PUBLIC 房）——按时间插入排序，
  // 使「主持人已开启全员禁言」等居中提示条在私聊视图同样可见，重载后与公聊视图一致
  const sysMsgs = publicMsgs.filter(m => m.senderRole === 'SYSTEM');
  const msgs = tab === 'PUBLIC' ? publicMsgs : [...privateMsgs, ...sysMsgs].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  // R4：阶段离开 OPENING 关输入；U11：control=CLOSED 关 host 输入（MUTED 不影响 host 发言）
  const inputDisabled = (tab === 'PRIVATE' && !activeSupplier) || stageClosed || control === 'CLOSED';
  const inputHint = stageClosed ? '开标阶段已结束，互动已关闭' : control === 'CLOSED' ? '主持人已关闭聊天大厅' : '';
  const connBadge = connection === 'connected'
    ? { text: '实时已连', cls: 'text-emerald-600', dot: 'bg-emerald-500' }
    : connection === 'reconnecting'
      ? { text: '重连中…', cls: 'text-amber-600', dot: 'bg-amber-500' }
      : { text: '已断开', cls: 'text-red-500', dot: 'bg-red-500' };

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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">会场交流</h3>
              {/* R10：连接态徽标；断开时给手动重连入口 */}
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${connBadge.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connBadge.dot}`} />
                {connBadge.text}
                {connection === 'disconnected' && (
                  <button onClick={reconnectNow} className="ml-0.5 font-semibold text-blue-600 hover:underline">重连</button>
                )}
              </span>
            </div>
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
            <button onClick={() => { setTab('PUBLIC'); setPublicUnread(0); openingHallApi.markRead(projectId, 'public', publicMsgs[publicMsgs.length - 1]?.id).catch(() => {}); }}
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

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
            {tab === 'PRIVATE' && !activeSupplier && <div className="pt-10 text-center text-xs text-slate-400">选择一家供应商开始私聊</div>}
            {msgs.map(m => m.senderRole === 'SYSTEM' ? (
              // 系统消息：居中提示条
              <div key={m.id} className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-slate-100 px-3 py-1 text-center text-[11px] text-slate-400">{m.content}</div>
            ) : (
              // 气泡式：己方（HOST）右对齐深色气泡，供应商左对齐带头像
              <div key={m.id} className={`my-3 flex items-start gap-2 ${m.senderRole === 'HOST' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ${m.senderRole === 'HOST' ? 'bg-slate-900' : 'bg-[#064ea2]'}`}>
                  {(m.senderName || '?').slice(0, 1)}
                </div>
                <div className={`flex max-w-[74%] flex-col ${m.senderRole === 'HOST' ? 'items-end' : 'items-start'}`}>
                  <div className="mb-0.5 text-[11px] text-slate-400">{m.senderName} · {fmtTime(m.createdAt)}</div>
                  <div className={`whitespace-pre-wrap break-all rounded-xl px-3 py-2 text-sm leading-relaxed ${m.senderRole === 'HOST'
                    ? 'rounded-tr-sm bg-slate-900 text-white'
                    : 'rounded-tl-sm border border-slate-200 bg-slate-50'}`}>{m.content}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200">
            {inputHint && <div className="px-3 pt-2 text-[11px] font-medium text-amber-600">{inputHint}</div>}
            <div className="flex gap-2 p-3">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) send(); }}
                placeholder={inputDisabled ? (tab === 'PRIVATE' && !activeSupplier ? '请先选择供应商' : '互动已关闭') : '输入消息（Enter 发送）'}
                disabled={inputDisabled}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
              />
              <button onClick={send} disabled={sending || !input.trim() || inputDisabled}
                className="rounded-xl bg-slate-900 px-4 text-sm text-white disabled:opacity-40">发送</button>
            </div>
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
