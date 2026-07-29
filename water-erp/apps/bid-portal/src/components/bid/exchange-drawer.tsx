'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareQuote, Plus, X } from 'lucide-react';
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

/** 主持人常用语：按开标流程阶段分组，点击填入输入框（可再编辑后发送）。
 *  措辞口径：解密由开标主持人统一执行（单条/批量解密 + 解密窗口），投标人只留意结果，
 *  故解密组均为「主持人解密」视角，不得写成「请各家完成解密」。 */
const HOST_PHRASES: { label: string; items: string[] }[] = [
  {
    label: '开场签到',
    items: [
      '各位投标人，本项目开标会现在开始，请各家确认在线并签到。',
      '请尚未签到的投标人尽快完成签到，开标时间即将到来。',
      '签到已完成，感谢各家准时参加，现在进入投标文件解密环节。',
    ],
  },
  {
    label: '文件解密',
    items: [
      '现在进入投标文件解密环节，将由主持人对各家的投标文件进行统一解密，请各家留意解密结果。',
      '正在对各家的投标文件进行解密，请各家耐心等待并留意本公司的解密状态。',
      '全部投标文件解密完成，现在进入唱标环节。',
      '个别投标人文件解密异常，工作人员正在处理，请相关单位耐心等待。',
      '解密窗口即将关闭，请各家留意解密结果，如有疑问请及时联系工作人员。',
    ],
  },
  {
    label: '唱标',
    items: [
      '现在开始唱标，请各家投标人仔细核对唱标内容。',
      '唱标完毕，请各家确认唱标内容与投标文件是否一致。',
    ],
  },
  {
    label: '异议处理',
    items: [
      '如对唱标内容有异议，请在异议窗口内通过系统提交，我们将依规处理。',
      '异议已收到，工作人员正在核实，请稍候。',
      '异议已处理完毕，感谢各家配合。',
    ],
  },
  {
    label: '结束离场',
    items: [
      '本次开标会各项议程已全部完成，感谢各位投标人参与，开标会到此结束。',
      '开标记录已生成，请各家确认后离场，谢谢。',
    ],
  },
  {
    label: '通用',
    items: [
      '请各位投标人保持在线，不要关闭会场。',
      '如遇系统问题，请及时通过会场交流联系工作人员。',
      '会场纪律提醒：请勿在会场内发布与开标无关的内容。',
    ],
  },
];

/** 自定义常用语持久化（浏览器本地）：custom = 用户新增条目；hiddenBuiltin = 被删除的内置语原文。 */
const PHRASES_STORAGE_KEY = 'bid-portal.host-phrases.v1';
type CustomPhrase = { label: string; text: string };
type PhraseStore = { custom: CustomPhrase[]; hiddenBuiltin: string[] };
type PhraseItem = { text: string; builtin: boolean };

/** 内凹按压态分段控件样式（与 supervision-view 共用） */
export const SEG_ACTIVE = 'rounded-[7px] px-2 py-1 text-xs font-semibold text-[color:var(--foreground)] bg-[oklch(0.92_0.012_258)] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.18),inset_-2px_-2px_5px_oklch(1_0_0_/_0.6)] transition-all';

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
  const [showPhrases, setShowPhrases] = useState(false);
  const [customPhrases, setCustomPhrases] = useState<CustomPhrase[]>([]);
  const [hiddenBuiltin, setHiddenBuiltin] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('自定义');
  const [newText, setNewText] = useState('');
  const [checkins, setCheckins] = useState<Record<string, string>>({});
  // R4：stage:change 离开 OPENING 后关闭输入；Wave 5-6：初值由页面当前项目阶段同步
  // （纯事件驱动时，阶段已离 OPENING 后才开的抽屉初始仍可输入，首次发送撞 403）
  const [stageClosed, setStageClosed] = useState(initialStageClosed ?? false);
  const hydratedRef = useRef(false); // R3：本轮打开是否已首载（决定重连后是否补齐）
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setShowPhrases(false);
    setShowAddForm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切项目时以新项目阶段初值复位；initialStageClosed 的后续变化由下方只升不降的 effect 接管
  }, [projectId]);

  // Wave 5-6：prop 初值同步——stageClosed 原纯事件驱动，阶段已离 OPENING 后才开的抽屉初始仍可输入。
  // 声明在切项目复位 effect 之后：同一 commit 内复位先跑、同步后跑，最终值正确。
  // 只升不降：事件已置 true 后不被 prop 回退（阶段不会倒流，防御 prop 闪变）
  useEffect(() => {
    setStageClosed(prev => prev || (initialStageClosed ?? false));
  }, [initialStageClosed]);

  // 常用语定制：首载从 localStorage 恢复（effect 仅客户端执行，SSR 阶段不触碰 localStorage）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PHRASES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PhraseStore>;
      if (Array.isArray(parsed.custom)) {
        setCustomPhrases(parsed.custom.filter((c): c is CustomPhrase => !!c && typeof c.label === 'string' && typeof c.text === 'string'));
      }
      if (Array.isArray(parsed.hiddenBuiltin)) {
        setHiddenBuiltin(parsed.hiddenBuiltin.filter((t): t is string => typeof t === 'string'));
      }
    } catch { /* 损坏数据跳过 */ }
  }, []);

  const persistPhrases = useCallback((custom: CustomPhrase[], hidden: string[]) => {
    try { localStorage.setItem(PHRASES_STORAGE_KEY, JSON.stringify({ custom, hiddenBuiltin: hidden })); } catch {}
  }, []);

  function addPhrase() {
    const text = newText.trim();
    if (!text) return;
    const next = [...customPhrases, { label: newLabel.trim() || '自定义', text }];
    setCustomPhrases(next);
    persistPhrases(next, hiddenBuiltin);
    setNewText('');
    setShowAddForm(false);
  }

  /** 删除常用语：内置语记入 hiddenBuiltin（下次渲染即隐藏），自定义条目直接移除；均持久化 */
  function removePhrase(item: PhraseItem, groupLabel: string) {
    if (item.builtin) {
      const next = [...hiddenBuiltin, item.text];
      setHiddenBuiltin(next);
      persistPhrases(customPhrases, next);
    } else {
      const next = customPhrases.filter(c => !(c.label === groupLabel && c.text === item.text));
      setCustomPhrases(next);
      persistPhrases(next, hiddenBuiltin);
    }
  }

  function restoreDefaultPhrases() {
    setCustomPhrases([]);
    setHiddenBuiltin([]);
    try { localStorage.removeItem(PHRASES_STORAGE_KEY); } catch {}
  }

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

  // 常用语分组渲染源：内置组剔除已删除项后，并入用户自定义条目（同名分组合并追加，新分组排末尾）
  const phraseGroups = useMemo(() => {
    const map = new Map<string, PhraseItem[]>();
    const order: string[] = [];
    for (const g of HOST_PHRASES) {
      const items = g.items.filter(t => !hiddenBuiltin.includes(t)).map(t => ({ text: t, builtin: true }));
      if (items.length) { map.set(g.label, items); order.push(g.label); }
    }
    for (const c of customPhrases) {
      if (!map.has(c.label)) { map.set(c.label, []); order.push(c.label); }
      map.get(c.label)!.push({ text: c.text, builtin: false });
    }
    return order.map(label => ({ label, items: map.get(label)! }));
  }, [customPhrases, hiddenBuiltin]);
  const phraseDirty = customPhrases.length > 0 || hiddenBuiltin.length > 0;

  // 私聊 tab 归并公聊里的 SYSTEM 控制提示（交流控制变更落 PUBLIC 房）——按时间插入排序，
  // 使「主持人已开启全员禁言」等居中提示条在私聊视图同样可见，重载后与公聊视图一致
  const sysMsgs = publicMsgs.filter(m => m.senderRole === 'SYSTEM');
  const msgs = tab === 'PUBLIC' ? publicMsgs : [...privateMsgs, ...sysMsgs].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  // R4：阶段离开 OPENING 关输入；U11：control=CLOSED 关 host 输入（MUTED 不影响 host 发言）
  const inputDisabled = (tab === 'PRIVATE' && !activeSupplier) || stageClosed || control === 'CLOSED';
  const inputHint = stageClosed ? '开标阶段已结束，互动已关闭' : control === 'CLOSED' ? '主持人已关闭聊天大厅' : '';
  const connBadge = connection === 'connected'
    ? { text: '实时已连', cls: 'text-[var(--success)]', dot: 'bg-[var(--success)]' }
    : connection === 'reconnecting'
      ? { text: '重连中…', cls: 'text-[var(--warning)]', dot: 'bg-[var(--warning)]' }
      : { text: '已断开', cls: 'text-[var(--danger)]', dot: 'bg-[var(--danger)]' };

  const segActive = SEG_ACTIVE;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="neu-btn-soft relative"
      >
        会场交流
        {(publicUnread > 0 || sessions.some(s => s.unread > 0)) && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
            {publicUnread + sessions.reduce((a, s) => a + s.unread, 0)}
          </span>
        )}
      </button>

      {/* C2：抽屉经 portal 渲染到 body——避免被父级 backdrop-filter / overflow-hidden 裁剪；
          抽屉仅在 open（客户端 state）为 true 时渲染，SSR 不触碰 document。
          层级：抽屉 z-40 低于唱标录入模态 z-50 ✓。新外壳无 sticky 顶栏，故浮动 inset 玻璃板。 */}
      {open && createPortal(
        <aside className="fixed bottom-2 right-2 top-2 z-40 flex w-[420px] max-w-[92vw] flex-col overflow-hidden rounded-[20px] bg-[linear-gradient(175deg,oklch(0.985_0.008_258_/_0.94),oklch(0.975_0.012_258_/_0.9))] shadow-[-6px_0_30px_oklch(0.45_0.06_258_/_0.18),inset_1px_0_0_oklch(1_0_0_/_0.7)] backdrop-blur-2xl">
          <header className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[color:var(--foreground)]">会场交流</h3>
              {/* R10：连接态徽标；断开时给手动重连入口 */}
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${connBadge.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connBadge.dot}`} />
                {connBadge.text}
                {connection === 'disconnected' && (
                  <button type="button" onClick={reconnectNow} className="ml-0.5 font-semibold text-[var(--accent-strong)] hover:underline">重连</button>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              {(['OPEN', 'MUTED', 'CLOSED'] as const).map(c => (
                <button key={c} type="button" onClick={() => changeControl(c)}
                  className={control === c ? segActive : 'neu-btn-xs'}>
                  {c === 'OPEN' ? '开放' : c === 'MUTED' ? '禁言' : '关闭'}
                </button>
              ))}
              <button type="button" onClick={() => setOpen(false)} className="neu-btn-xs ml-2" aria-label="关闭"><X size={14} /></button>
            </div>
          </header>

          <div className="border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-2">
            <div className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">在场名单（{roster.length}）</div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map(s => (
                <span key={s.supplierId} className="rounded-md bg-[oklch(0.71_0.11_164_/_0.14)] px-2 py-0.5 text-xs font-medium text-[oklch(0.5_0.12_160)]">
                  {s.supplierName}{s.checkInAt || checkins[s.supplierId] ? ' ✓签到' : ''}
                </span>
              ))}
              {roster.length === 0 && <span className="text-xs text-[color:var(--muted-foreground)]">暂无供应商在线</span>}
            </div>
          </div>

          <div className="flex gap-2 border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-2 text-sm">
            <button type="button" onClick={() => { setTab('PUBLIC'); setPublicUnread(0); openingHallApi.markRead(projectId, 'public', publicMsgs[publicMsgs.length - 1]?.id).catch(() => {}); }}
              className={tab === 'PUBLIC' ? 'font-semibold text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]'}>
              公聊{publicUnread > 0 ? ` (${publicUnread})` : ''}
            </button>
            <button type="button" onClick={() => setTab('PRIVATE')}
              className={tab === 'PRIVATE' ? 'font-semibold text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]'}>
              私聊
            </button>
          </div>

          {tab === 'PRIVATE' && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-2">
              {sessions.map(s => (
                <button key={s.supplierId} type="button" onClick={() => openPrivate(s)}
                  className={activeSupplier?.supplierId === s.supplierId ? `${segActive} whitespace-nowrap` : 'neu-btn-xs whitespace-nowrap'}>
                  {s.supplierName}{s.unread > 0 ? ` ●${s.unread}` : ''}
                </button>
              ))}
              {sessions.length === 0 && <span className="text-xs text-[color:var(--muted-foreground)]">暂无供应商参与</span>}
            </div>
          )}

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
            {tab === 'PRIVATE' && !activeSupplier && <div className="pt-10 text-center text-xs text-[color:var(--muted-foreground)]">选择一家供应商开始私聊</div>}
            {msgs.map(m => m.senderRole === 'SYSTEM' ? (
              // 系统消息：居中提示条
              <div key={m.id} className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-[oklch(0.6_0.04_258_/_0.12)] px-3 py-1 text-center text-[11px] text-[color:var(--muted-foreground)]">{m.content}</div>
            ) : (
              // 气泡式：己方（HOST）右对齐品牌气泡，供应商左对齐带头像 + 凸起玻璃泡
              <div key={m.id} className={`my-3 flex items-start gap-2 ${m.senderRole === 'HOST' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ${m.senderRole === 'HOST' ? 'bg-[oklch(0.32_0.04_258)]' : 'bg-[var(--accent-strong)]'}`}>
                  {(m.senderName || '?').slice(0, 1)}
                </div>
                <div className={`flex max-w-[74%] flex-col ${m.senderRole === 'HOST' ? 'items-end' : 'items-start'}`}>
                  <div className="mb-0.5 text-[11px] text-[color:var(--muted-foreground)]">{m.senderName} · {fmtTime(m.createdAt)}</div>
                  <div className={`whitespace-pre-wrap break-all rounded-xl px-3 py-2 text-sm leading-relaxed ${m.senderRole === 'HOST'
                    ? 'rounded-tr-sm bg-[var(--accent-strong)] text-white shadow-[2px_2px_6px_oklch(0.45_0.08_258_/_0.18)]'
                    : 'rounded-tl-sm bg-[oklch(0.985_0.006_258)] text-[color:var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7),2px_2px_5px_oklch(0.55_0.03_258_/_0.1),-1px_-1px_3px_oklch(1_0_0_/_0.85)]'}`}>{m.content}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[oklch(0.6_0.04_258_/_0.14)]">
            {inputHint && <div className="px-3 pt-2 text-[11px] font-medium text-[var(--warning)]">{inputHint}</div>}
            {/* 主持人常用语：点击填入输入框（可再编辑后发送）；输入禁用（阶段结束/大厅关闭）时不展开。
                「+」新增自定义常用语、「×」删除条目（内置语记隐藏、自定义移除）、「恢复默认」清空定制，均持久化 localStorage */}
            {showPhrases && !inputDisabled && (
              <div className={`flex flex-col transition-[max-height] duration-300 ease-out ${showAddForm ? 'max-h-[460px]' : 'max-h-64'}`}>
                <div className="flex flex-none items-center justify-between px-3.5 pb-1.5 pt-2">
                  <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">常用语管理</span>
                  <div className="flex items-center gap-1">
                    {phraseDirty && (
                      <button type="button" onClick={restoreDefaultPhrases}
                        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(0.6_0.04_258_/_0.12)] hover:text-[color:var(--foreground)]">
                        恢复默认
                      </button>
                    )}
                    <button type="button" onClick={() => setShowAddForm(s => !s)} title="新增常用语"
                      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-all ${showAddForm
                        ? 'bg-[oklch(0.92_0.012_258)] text-[color:var(--foreground)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258_/_0.18)]'
                        : 'text-[color:var(--accent-strong)] hover:bg-[oklch(0.96_0.02_258)]'}`}>
                      <Plus size={12} />新增
                    </button>
                  </div>
                </div>

                {showAddForm && (
                  <div className="flex-none border-y border-[oklch(0.6_0.04_258_/_0.14)] px-3.5 py-2.5">
                    <div className="mb-2 flex items-center gap-2">
                      <label className="flex-none text-[11px] font-semibold text-[color:var(--muted-foreground)]">分组</label>
                      {/* .neu-input/.neu-btn-primary 的字号高度写在 layer 外（14px/40px），面板内统一 12px 行高须 ! 覆盖 */}
                      <select value={newLabel} onChange={e => setNewLabel(e.target.value)} className="neu-input !h-7 min-w-0 flex-1 !text-xs">
                        {HOST_PHRASES.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                        <option value="自定义">自定义</option>
                      </select>
                    </div>
                    <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={3}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addPhrase(); }}
                      placeholder="输入常用语内容…（Ctrl+Enter 保存）"
                      className="neu-input !h-auto w-full resize-none !py-2 !text-xs leading-relaxed" />
                    <div className="mt-2.5 flex justify-end gap-1.5">
                      <button type="button" onClick={() => { setShowAddForm(false); setNewText(''); }} className="neu-btn-xs">取消</button>
                      <button type="button" onClick={addPhrase} disabled={!newText.trim()}
                        className="neu-btn-primary !h-7 !px-3 !text-xs disabled:opacity-40">保存</button>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto px-3.5 pb-2.5 pt-2">
                  {phraseGroups.map(g => (
                    <div key={g.label} className="mb-2 last:mb-0">
                      <div className="mb-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">{g.label}</div>
                      <div className="flex flex-col gap-1">
                        {g.items.map(item => (
                          <div key={item.text} className="group flex items-stretch gap-1">
                            <button type="button"
                              onClick={() => { setInput(item.text); setShowPhrases(false); inputRef.current?.focus(); }}
                              className="flex-1 rounded-lg bg-[oklch(0.985_0.006_258)] px-2.5 py-1.5 text-left text-xs leading-relaxed text-[color:var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7),1px_1px_3px_oklch(0.55_0.03_258_/_0.1),-1px_-1px_2px_oklch(1_0_0_/_0.8)] transition-colors hover:bg-[oklch(0.96_0.02_258)] hover:text-[color:var(--accent-strong)]">
                              {item.text}
                            </button>
                            <button type="button" onClick={() => removePhrase(item, g.label)} title="删除该常用语"
                              className="flex-none self-center rounded-md px-1 text-[color:var(--muted-foreground)] opacity-0 transition-all hover:bg-[oklch(0.95_0.05_27_/_0.5)] hover:text-[var(--danger)] group-hover:opacity-100">
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {phraseGroups.length === 0 && (
                    <div className="py-3 text-center text-xs text-[color:var(--muted-foreground)]">暂无常用语，点右上角「+新增」添加</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-2 p-3">
              <button type="button"
                onClick={() => setShowPhrases(s => !s)}
                disabled={inputDisabled}
                title="常用语"
                className={`inline-flex items-center !h-[40px] gap-1 whitespace-nowrap !px-2.5 text-xs ${showPhrases && !inputDisabled ? segActive : 'neu-btn-xs'}`}>
                <MessageSquareQuote size={15} />常用语
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) send(); }}
                placeholder={inputDisabled ? (tab === 'PRIVATE' && !activeSupplier ? '请先选择供应商' : '互动已关闭') : '输入消息（Enter 发送）'}
                disabled={inputDisabled}
                className="neu-input flex-1"
              />
              <button type="button" onClick={send} disabled={sending || !input.trim() || inputDisabled}
                className="neu-btn-primary !h-[40px] !px-4 text-sm disabled:opacity-40">发送</button>
            </div>
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
