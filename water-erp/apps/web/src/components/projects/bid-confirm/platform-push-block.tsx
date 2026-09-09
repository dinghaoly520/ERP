'use client';

/**
 * 省平台数据对接专项 Phase 1（doc §五）——:3005 开标确认面板·「上级平台推送」区块
 * （SupervisionPushBlock 之后并列新增；A-153 监督推送块原样保留，Phase 2 再评估合并）。
 * 383号文十类信息 → 五通道人工确认制全链：勾选（⚠ 禁推行禁勾）→ 必经预览弹窗
 * （中间信封 JSON + 限价/合同金额脱敏开关 + payloadHash + 真实性责任提示）→
 * 二次确认（通道/条数/mock 演示标注）→ dispatch 或离线导出；推送台账复用 status 端点。
 * 外壳/标题/toast/弹窗 idiom 镜像同目录 supervision-push-block。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CloudUpload, Eye, FileDown, History, Send, ShieldAlert,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import { ApiError } from '@/lib/api';
import {
  platformPushApi, type ItemHashPair, type PendingItem, type PendingResponse,
  type PreviewResponse, type PushChannelCode, type PushItemType, type PushMaskOptions,
  type PushStatusResponse,
} from '@/lib/api/platform-push';

type Props = { bidProjectId: string };

/** 383号文信息范围十类标签（doc §三映射表） */
const ITEM_TYPE_LABELS: Record<PushItemType, string> = {
  plan: '招标计划',
  bid_notice: '招标公告',
  clarify: '澄清/修改',
  failed_bid: '流标公告',
  pre_win: '中标候选人公示',
  win: '中标结果公示',
  contract: '合同公告',
  fulfillment: '履约信息',
  penalty: '处罚信息',
  prequal: '资格预审',
};

/** 清单显示顺序（后端 pending 无序约束，前端按信息范围序） */
const ITEM_TYPE_ORDER: PushItemType[] = [
  'plan', 'bid_notice', 'clarify', 'failed_bid', 'pre_win', 'win',
  'contract', 'fulfillment', 'penalty', 'prequal',
];

/** 通道静态目录（connected 态以 pending.channels 后端返回为准合并） */
const CHANNELS: { code: PushChannelCode; title: string }[] = [
  { code: 'offline', title: '离线导出（文件包）' },
  { code: 'mock', title: '演示通道(mock)' },
  { code: 'sc_province', title: '四川省公共资源交易平台' },
  { code: 'ceb_national', title: '中国招标投标公共服务平台' },
  { code: 'mwr_water', title: '全国水利建设市场监管平台' },
];

const MISSING_HINTS: Record<string, string> = {
  gbProcureCode: '项目未取得国标采购编码（21 位统一交易识别码）——存量项目在回填清单内，新项目创建时自动赋码',
  publishDate: '公告缺少发布时间——到信息发布中心补录',
  amount: '合同缺少金额——补录合同金额（公开口径）',
  signedAt: '合同缺少签订时间——补录合同签订日期',
};

const PUSH_STATUS_LABELS: Record<string, string> = {
  SUCCESS: '成功',
  FAILED: '失败',
  EXPORTED: '已导出',
  STUB_REFUSED: '拒送·未连通',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return `[${e.code}] ${e.message}`;
  return e instanceof Error ? e.message : '操作失败';
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

export function PlatformPushBlock({ bidProjectId }: Props) {
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<PushChannelCode>('offline');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // 预览态（人工确认制第一步：mask 变更即重新预览——hash 含脱敏效果）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewedIds, setPreviewedIds] = useState<Set<string>>(new Set());
  const [mask, setMask] = useState<PushMaskOptions>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledger, setLedger] = useState<PushStatusResponse | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const load = useCallback(() => {
    platformPushApi
      .pending(bidProjectId)
      .then((p) => {
        setPending(p);
        setLoadFailed(false);
        // 项目切换/数据刷新后收敛勾选集（仅保留仍在清单内的可推项）
        setSelected((prev) => {
          const alive = new Set(p.items.filter((i) => i.ready).map((i) => i.itemId));
          const next = new Set([...prev].filter((id) => alive.has(id)));
          return next.size === prev.size ? prev : next;
        });
      })
      .catch(() => { setPending(null); setLoadFailed(true); });
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), tone === 'err' ? 6000 : 3600);
  };

  const loadLedger = useCallback(() => {
    setLedgerLoading(true);
    // 不按项目过滤：处罚信息为平台级全局行（log.projectId=null），项目过滤会吞掉其台账
    platformPushApi
      .status()
      .then(setLedger)
      .catch(() => setLedger(null))
      .finally(() => setLedgerLoading(false));
  }, []);

  function openLedger() {
    setLedgerOpen(true);
    loadLedger();
  }

  const items = useMemo(() => pending?.items ?? [], [pending]);
  const readyItems = useMemo(() => items.filter((i) => i.ready), [items]);
  const notReadyCount = items.length - readyItems.length;

  // 通道连通态：以后端 pending.channels 为准（stub 三通道 connected=false）
  const channelConnected = (code: PushChannelCode): boolean | null =>
    pending?.channels.find((c) => c.code === code)?.connected ?? null;
  const channelTitle = (code: PushChannelCode): string =>
    pending?.channels.find((c) => c.code === code)?.title
    ?? CHANNELS.find((c) => c.code === code)?.title
    ?? code;
  const isStub = channelConnected(channel) === false;
  const isOffline = channel === 'offline';

  // 按 itemType 分组（保持信息范围序）
  const groups = useMemo(() => {
    const byType = new Map<PushItemType, PendingItem[]>();
    for (const it of items) {
      const arr = byType.get(it.itemType) ?? [];
      arr.push(it);
      byType.set(it.itemType, arr);
    }
    return ITEM_TYPE_ORDER
      .filter((t) => byType.has(t))
      .map((t) => ({ itemType: t, rows: byType.get(t)! }));
  }, [items]);

  function toggleItem(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleGroup(itemType: PushItemType, readyIds: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = readyIds.every((id) => next.has(id));
      for (const id of readyIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** 预览（打开弹窗与 mask 变更共用：每次都拿最新信封+指纹） */
  async function runPreview(ids: string[], m: PushMaskOptions) {
    setPreviewBusy(true);
    try {
      const data = await platformPushApi.preview(ids, m);
      setPreviewData(data);
      setPreviewedIds(new Set(ids));
    } catch (e) {
      showToast(`预览失败：${errText(e)}`, 'err');
    } finally {
      setPreviewBusy(false);
    }
  }

  function openPreview() {
    setMask({});
    setPreviewData(null);
    setPreviewOpen(true);
    void runPreview([...selected], {});
  }

  function toggleMask(key: 'ceilingPrice' | 'contractAmount', on: boolean) {
    const next = { ...mask, [key]: on };
    setMask(next);
    void runPreview([...previewedIds], next); // 变更即重新预览——脱敏效果计入 payloadHash
  }

  const previewMatchesSelection = sameSet(previewedIds, selected);

  async function handleConfirm() {
    if (!previewData || !previewMatchesSelection) return;
    const itemIds = [...selected];
    const byId = new Map(previewData.items.map((p) => [p.itemId, p.payloadHash]));
    const payloadHashes: ItemHashPair[] = itemIds.map((id) => ({ itemId: id, payloadHash: byId.get(id)! }));
    setBusy(true);
    try {
      if (isOffline) {
        const res = await platformPushApi.exportItems(itemIds, payloadHashes, mask);
        const okCount = res.results.filter((r) => r.status === 'EXPORTED').length;
        const first = res.results.find((r) => r.downloadUrl);
        if (first?.downloadUrl) {
          // 受保护下载禁用 noreferrer（丢 Referer → 门户识别失败 401）
          window.open(first.downloadUrl, '_blank', 'noopener');
        }
        showToast(`已离线导出 ${okCount}/${res.results.length} 个数据项文件包${first ? '（首个已在新窗口打开，其余见推送台账）' : ''}`,
          okCount === res.results.length ? 'ok' : 'err');
      } else {
        const res = await platformPushApi.dispatch(channel, itemIds, payloadHashes, mask);
        const ok = res.results.filter((r) => r.status === 'SUCCESS').length;
        const bad = res.results.length - ok;
        const firstErr = res.results.find((r) => r.status !== 'SUCCESS')?.errorMessage;
        showToast(bad === 0
          ? `推送完成（${channelTitle(channel)}）：成功 ${ok} 项`
          : `推送完成（${channelTitle(channel)}）：成功 ${ok} 项、失败 ${bad} 项${firstErr ? `——${firstErr}` : ''}`,
          bad === 0 ? 'ok' : 'err');
      }
      setConfirmOpen(false);
      setPreviewOpen(false);
      setPreviewData(null);
      setPreviewedIds(new Set());
      setSelected(new Set());
      load();
      if (ledgerOpen) loadLedger();
    } catch (e) {
      // stub 通道 501 CHANNEL_NOT_CONNECTED / 幂等 409 ALREADY_PUSHED / 漂移 400 PAYLOAD_DRIFT 在此透出
      showToast(errText(e), 'err');
      if (ledgerOpen) loadLedger();
    } finally {
      setBusy(false);
    }
  }

  const gbCode = pending?.project.gbProcureCode;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center gap-2.5 min-w-0">
        <div
          className="wb-icon-well wb-icon-well--xs"
          style={{ '--well-bg': 'color-mix(in oklch, var(--accent) 12%, transparent)', '--well-fg': 'var(--accent)' } as React.CSSProperties}
        >
          <Send size={15} />
        </div>
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">上级平台推送</h3>
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">383号文十类 · 人工确认制</span>
      </div>

      {feedback && (
        <div className={`wb-tone-banner mb-3 text-xs font-medium ${feedback.tone === 'ok' ? 'wb-tone-banner--success' : 'wb-tone-banner--danger'}`}>
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
        </div>
      )}

      {/* 状态行：统一交易识别码锚 + 清单概览 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>
          国标采购编码：
          <span className="font-semibold text-[var(--foreground)] tabular-nums">{gbCode ?? '—'}</span>
        </span>
        {pending && (
          <span>
            待推数据项 <span className="font-semibold tabular-nums text-[var(--foreground)]">{items.length}</span> 项
            （可推 {readyItems.length}{notReadyCount > 0 ? ` · 待补全 ${notReadyCount}` : ''}）
          </span>
        )}
        {loadFailed && <span className="text-[var(--warning)]">清单加载失败，可重试操作</span>}
      </div>

      {/* 工具行：通道选择 + 预览入口 + 台账 */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <select
          className="workbench-input !h-[32px] !w-auto min-w-[190px] !text-xs"
          value={channel}
          onChange={(e) => setChannel(e.target.value as PushChannelCode)}
        >
          {CHANNELS.map((c) => {
            const connected = channelConnected(c.code);
            return (
              <option key={c.code} value={c.code}>
                {c.title}
                {connected === false ? '（未连通）' : ''}
              </option>
            );
          })}
        </select>
        {channel === 'mock' && (
          <span className="rounded border border-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
            演示通道——非真实推送
          </span>
        )}
        {isStub && (
          <span className="text-[10px] font-semibold text-[var(--warning)]">
            通道未连通（stub）——推送将收到 501 引导离线导出
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="neu-btn-soft !h-[32px] !text-xs" onClick={openLedger}>
            <History size={13} /> 推送台账
          </button>
          <button
            type="button"
            className="neu-btn-primary !h-[32px] !text-xs shrink-0"
            onClick={openPreview}
            disabled={busy || selected.size === 0}
            title={selected.size === 0 ? '先勾选可推数据项（⚠ 待补全行禁勾）' : '预览中间信封（人工确认制第一步——推送前必经）'}
          >
            <Eye size={13} /> 预览选中{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      {/* 待推清单（按信息类别分组；⚠ 行禁勾+补全指引） */}
      <div className="neu-table-card overflow-hidden">
        <table className="neu-table !text-xs">
          <thead>
            <tr>
              <th className="w-[36px]"></th>
              <th className="w-[110px]">信息类别</th>
              <th>标题</th>
              <th className="w-[130px]">映射完整度</th>
              <th className="w-[170px]">最近推送</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ itemType, rows }) => {
              const readyIds = rows.filter((r) => r.ready).map((r) => r.itemId);
              const allOn = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
              return (
                [<tr key={`${itemType}-head`} className="bg-[var(--muted)]/40">
                  <td colSpan={5} className="!py-1.5">
                    <label className="flex cursor-pointer items-center gap-2 font-semibold text-[var(--foreground)]">
                      <input
                        type="checkbox"
                        className="neu-checkbox"
                        checked={allOn}
                        disabled={readyIds.length === 0}
                        onChange={() => toggleGroup(itemType, readyIds)}
                      />
                      {ITEM_TYPE_LABELS[itemType]}
                      <span className="font-normal text-[10px] text-[var(--muted-foreground)] tabular-nums">
                        {readyIds.length}/{rows.length} 可推 · 全选本组
                      </span>
                    </label>
                  </td>
                </tr>,
                ...rows.map((row) => {
                  const missingHints = row.missing.map((m) => MISSING_HINTS[m] ?? m);
                  const lp = row.lastPush;
                  return (
                    <tr key={row.itemId} className={row.ready ? '' : 'opacity-70'}>
                      <td className="!py-2">
                        <input
                          type="checkbox"
                          className="neu-checkbox"
                          checked={selected.has(row.itemId)}
                          disabled={!row.ready || busy}
                          onChange={() => toggleItem(row.itemId)}
                        />
                      </td>
                      <td className="!py-2">
                        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                          {ITEM_TYPE_LABELS[row.itemType] ?? row.itemType}
                        </span>
                      </td>
                      <td className="!py-2 max-w-[300px]">
                        <span className="block truncate" title={row.title}>{row.title}</span>
                      </td>
                      <td className="!py-2">
                        {row.ready ? (
                          <span className="font-semibold text-[var(--success)]">完整</span>
                        ) : (
                          <span
                            className="font-semibold text-[var(--warning)]"
                            title={`缺 ${row.missing.join('/')}——${missingHints.join('；')}`}
                          >
                            ⚠ 待补全（{row.missing.join('/')}）
                          </span>
                        )}
                      </td>
                      <td className="!py-2 text-[var(--muted-foreground)]">
                        {lp ? (
                          <span
                            className={
                              lp.status === 'SUCCESS' || lp.status === 'EXPORTED'
                                ? 'text-[var(--success)]'
                                : lp.status === 'STUB_REFUSED'
                                  ? 'text-[var(--warning)]'
                                  : 'text-[var(--danger)]'
                            }
                            title={lp.responseSnippet ?? undefined}
                          >
                            {PUSH_STATUS_LABELS[lp.status] ?? lp.status} · {lp.channel} · {formatDateTime(lp.createdAt)}
                          </span>
                        ) : '未推送'}
                      </td>
                    </tr>
                  );
                })]
              );
            })}
            {!pending && (
              <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted-foreground)]">清单加载中…</td></tr>
            )}
            {pending && items.length === 0 && (
              <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted-foreground)]">本项目暂无待推数据项（公告未发布或无合同/处罚信息）</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[10px] text-[var(--muted-foreground)]">
        <ShieldAlert size={12} className="mt-0.5 shrink-0" />
        人工确认制：推送前必经预览（payloadHash 防预览后数据漂移）；发布内容真实性、准确性、合法性由发布人负责；涉密信息须脱密脱敏后发布。
      </p>

      {/* 预览弹窗（人工确认制第一步：信封 JSON + 脱敏开关 + 指纹 + 责任提示） */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="推送内容预览（中间信封）"
        description="schema=sc-v2-preview——推送/导出将校验下列逐项载荷指纹（payloadHash），预览后数据变化将被拒绝"
        size="xl"
        footer={
          <>
            <button type="button" className="neu-btn-soft !h-[36px] !text-xs" onClick={() => setPreviewOpen(false)}>取消</button>
            <button
              type="button"
              className={`!h-[36px] !text-xs shrink-0 ${isStub ? 'neu-btn-soft !text-[var(--warning)]' : 'neu-btn-primary'}`}
              onClick={() => setConfirmOpen(true)}
              disabled={busy || previewBusy || !previewData || previewData.items.length === 0 || !previewMatchesSelection}
              title={!previewMatchesSelection ? '勾选已变化——请关闭预览后重新预览' : undefined}
            >
              {isOffline
                ? <><FileDown size={13} /> 离线导出（{previewedIds.size} 项）</>
                : isStub
                  ? <><CloudUpload size={13} /> 推送·通道未连通（{previewedIds.size} 项）</>
                  : <><CloudUpload size={13} /> 推送{channel === 'mock' ? '至演示通道' : ''}（{previewedIds.size} 项）</>}
            </button>
          </>
        }
      >
        {/* 脱敏开关（doc §七-3：限价/合同金额；变更即重新计算指纹） */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <span className="font-semibold text-[var(--foreground)]">脱敏选项：</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="neu-checkbox"
              checked={mask.ceilingPrice ?? false}
              onChange={(e) => toggleMask('ceilingPrice', e.target.checked)}
            />
            最高限价置空（招标公告）
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="neu-checkbox"
              checked={mask.contractAmount ?? false}
              onChange={(e) => toggleMask('contractAmount', e.target.checked)}
            />
            合同金额置空（合同公告）
          </label>
          <span className="text-[10px] text-[var(--muted-foreground)]">变更即重新预览——脱敏效果计入 payloadHash</span>
        </div>

        {previewBusy && <p className="text-xs text-[var(--muted-foreground)]">信封生成中…</p>}
        {!previewBusy && previewData && previewData.items.map((p) => (
          <details key={p.itemId} open={previewData.items.length === 1} className="mb-2 rounded-xl border border-[var(--border)]">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                {ITEM_TYPE_LABELS[p.itemType] ?? p.itemType}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--foreground)]">{p.envelope.title}</span>
              <span className="font-mono text-[10px] break-all text-[var(--muted-foreground)]" title={p.payloadHash}>
                {p.payloadHash.slice(0, 12)}…{p.payloadHash.slice(-8)}
              </span>
            </summary>
            <div className="border-t border-[var(--border)] px-3 py-2">
              <div className="mb-1 text-[10px] text-[var(--muted-foreground)]">
                payloadHash（sha256）：<span className="font-mono break-all">{p.payloadHash}</span>
                {p.envelope.masked.length > 0 && (
                  <span className="ml-2 font-semibold text-[var(--warning)]">已脱敏：{p.envelope.masked.join('、')}</span>
                )}
              </div>
              <pre className="max-h-[300px] overflow-auto rounded-lg bg-[var(--muted)]/50 p-2.5 font-mono text-[11px] leading-relaxed text-[var(--foreground)]">
                {JSON.stringify(p.envelope, null, 2)}
              </pre>
            </div>
          </details>
        ))}
        {!previewBusy && !previewData && (
          <p className="text-xs text-[var(--muted-foreground)]">预览失败或暂无内容——关闭后重试。</p>
        )}

        <div className="wb-tone-banner wb-tone-banner--warning mt-2 text-xs font-medium">
          <ShieldAlert size={13} className="shrink-0" />
          发布内容真实性、准确性、合法性由发布人负责（集团侧工作人员）；涉密项目不公开，确需公开的脱密脱敏并经保密审查后发布。
        </div>
      </Modal>

      {/* 二次确认（通道/条数/mock 演示/未连通提示） */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={isOffline ? '确认离线导出' : '确认推送'}
        description="人工确认制第二步——请核对通道与条数"
        footer={
          <>
            <button type="button" className="neu-btn-soft !h-[36px] !text-xs" onClick={() => setConfirmOpen(false)} disabled={busy}>取消</button>
            <button type="button" className="neu-btn-primary !h-[36px] !text-xs" onClick={() => void handleConfirm()} disabled={busy}>
              {busy ? '处理中…' : isOffline ? '确认导出' : '确认推送'}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">推送通道</span>
            <span className="text-right font-semibold text-[var(--foreground)]">{channelTitle(channel)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">数据项数</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]">{previewedIds.size} 项</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">载荷指纹校验</span>
            <span className="text-right text-[var(--foreground)]">{previewedIds.size} 项 payloadHash（不一致将拒绝）</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">脱敏</span>
            <span className="text-right text-[var(--foreground)]">
              {mask.ceilingPrice || mask.contractAmount
                ? [mask.ceilingPrice ? '限价' : null, mask.contractAmount ? '合同金额' : null].filter(Boolean).join('、')
                : '未启用'}
            </span>
          </div>
          {channel === 'mock' && (
            <div className="wb-tone-banner wb-tone-banner--info text-xs font-medium">
              演示通道：非真实推送（回执前缀 MOCK-），仅用于验证人工确认制全链留痕。
            </div>
          )}
          {isStub && (
            <div className="wb-tone-banner wb-tone-banner--warning text-xs font-medium">
              该通道未连通（省平台接口规约未发布，Phase 2 联调后启用）——本次推送预期收到 501 并被引导改用「离线导出」。
            </div>
          )}
        </div>
      </Modal>

      {/* 推送台账（全局含处罚行；EXPORTED 行可下载文件包） */}
      <Modal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        title="推送台账"
        description="每次推送/导出/拒送各记一行（全局台账——含跨项目的处罚信息行）；最近 200 条"
        size="lg"
      >
        <div className="mb-2.5 flex flex-wrap gap-2 text-xs">
          {ledger && Object.entries(ledger.summary).map(([st, n]) => (
            <span
              key={st}
              className={`rounded-full border px-2.5 py-0.5 font-semibold tabular-nums ${
                st === 'SUCCESS' || st === 'EXPORTED'
                  ? 'border-[var(--success)] text-[var(--success)]'
                  : st === 'STUB_REFUSED'
                    ? 'border-[var(--warning)] text-[var(--warning)]'
                    : 'border-[var(--danger)] text-[var(--danger)]'
              }`}
            >
              {PUSH_STATUS_LABELS[st] ?? st} {n}
            </span>
          ))}
          {ledger && Object.keys(ledger.summary).length === 0 && (
            <span className="text-[var(--muted-foreground)]">暂无记录</span>
          )}
        </div>
        <div className="neu-table-card overflow-hidden">
          <table className="neu-table !text-xs">
            <thead>
              <tr>
                <th>时间</th>
                <th>通道</th>
                <th>信息类别</th>
                <th>数据项</th>
                <th>第 N 次</th>
                <th>状态</th>
                <th>文件包</th>
              </tr>
            </thead>
            <tbody>
              {(ledger?.logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="!py-2 tabular-nums text-[var(--muted-foreground)]">{formatDateTime(l.createdAt)}</td>
                  <td className="!py-2">{l.channel}</td>
                  <td className="!py-2">{ITEM_TYPE_LABELS[l.itemType as PushItemType] ?? l.itemType}</td>
                  <td className="!py-2 max-w-[220px] truncate" title={l.itemId}>{l.itemId}</td>
                  <td className="!py-2 tabular-nums">{l.attemptNo}</td>
                  <td className="!py-2">
                    <span
                      className={
                        l.status === 'SUCCESS' || l.status === 'EXPORTED'
                          ? 'font-semibold text-[var(--success)]'
                          : l.status === 'STUB_REFUSED'
                            ? 'font-semibold text-[var(--warning)]'
                            : 'font-semibold text-[var(--danger)]'
                      }
                      title={l.errorMessage ?? l.responseSnippet ?? undefined}
                    >
                      {PUSH_STATUS_LABELS[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="!py-2">
                    {l.packetAssetId ? (
                      /* 受保护下载禁用 noreferrer（丢 Referer → 门户识别失败 401） */
                      <a href={`/api/upload/files/${l.packetAssetId}`} target="_blank" rel="noopener" className="font-semibold text-[var(--accent)] hover:underline">
                        下载
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {ledgerLoading && (
                <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted-foreground)]">加载中…</td></tr>
              )}
              {!ledgerLoading && (!ledger || ledger.logs.length === 0) && (
                <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted-foreground)]">暂无推送记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>
    </section>
  );
}
