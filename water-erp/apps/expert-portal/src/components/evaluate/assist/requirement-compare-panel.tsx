// requirement-compare-panel.tsx
'use client';
import { useMemo, useState, useEffect } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle, FileText, Maximize2, Minimize2, Edit3, ChevronRight, ChevronDown, Sparkles, MessageSquarePlus, Loader2 } from 'lucide-react';
import type { RequirementResponse, BidRequirementReview, BidScoreItem } from '@water-erp/shared';
import { CATEGORY_COLOR, CATEGORY_LABEL, isPassFailCategory } from '@water-erp/shared';
import { api } from '@/lib/api';
import { PointChecklistScoring, type PointDecisionValue } from '@/components/evaluate/point-checklist-scoring';

/** 桌面端评分条目态（与 page.tsx ScoreEntry 对齐，只取 panel 需要的字段） */
type ScoreVal = { score: number; reason: string; passed?: boolean; points?: Record<string, PointDecisionValue> };

interface ReqItem {
  id: string;
  category: string;
  content: string;
  isStarred?: boolean;
  acceptanceCriteria?: string;
  threshold?: string;
  evidenceType?: string;
  /** 条款在招标文件中的首次页码（LLM 标注）；有值时显示「跳原文」按钮 */
  sourcePage?: number;
}

const CAT_LABEL: Record<string, string> = {
  qualification: '资格要求',
  technical: '技术要求',
  commercial: '商务要求',
};

// Phase 0：条款类别 → 评分类别（与后端 getMyScores 的 UPPER 映射一致；★实质性条款另映射 RESPONSIVE 响应性评审）
const CAT_TO_SCORE: Record<string, string[]> = {
  qualification: ['QUALIFICATION'],
  technical: ['TECHNICAL'],
  commercial: ['BUSINESS'],
};

const STATUS_CFG: Record<string, { label: string; c: string; icon: any }> = {
  met: { label: '满足', c: 'var(--success)', icon: CheckCircle },
  partial: { label: '部分', c: 'var(--warning)', icon: HelpCircle },
  unmet: { label: '不满足', c: 'var(--danger)', icon: XCircle },
  not_found: { label: '未提及', c: 'var(--muted-foreground)', icon: AlertCircle },
};

const VERDICT_CFG: { key: 'ack' | 'dispute' | 'doubt'; label: string; activeCls: string; activeBg: string }[] = [
  { key: 'ack', label: '认可', activeCls: 'is-success', activeBg: '!bg-[oklch(0.96_0.05_164/0.5)]' },
  { key: 'dispute', label: '异议', activeCls: 'is-danger', activeBg: '!bg-[oklch(0.96_0.05_27/0.5)]' },
  { key: 'doubt', label: '存疑', activeCls: 'is-warning', activeBg: '!bg-[oklch(0.96_0.05_83/0.5)]' },
];

export function RequirementComparePanel({
  projectId,
  supplierId,
  requirements,
  responses,
  reviews,
  tenderDocUrl,
  scoreItems,
  scoreStatus,
  onGoScoring,
  scores,
  onPointChange,
  onPointNote,
}: {
  projectId: string;
  supplierId: string;
  requirements: any;
  responses: RequirementResponse[];
  reviews: BidRequirementReview[];
  /** 招标文件解密下载 URL（模式 2 iframe src）；为空时隐藏「招标文件」tab */
  tenderDocUrl?: string;
  /** 项目评分项全集 */
  scoreItems: BidScoreItem[];
  /** 当前供应商各评分项状态（committed 已提交 / draft 草稿 / empty 未填） */
  scoreStatus: Record<string, { state: 'committed' | 'draft' | 'empty'; score: number; passed?: boolean }>;
  /** 「去打分平板」：桌面端发送 focus hint 到平板（target=选中条款映射的首个打分项，无映射则仅切供应商） */
  onGoScoring: (target?: { scoreItemId: string; pointId?: string }) => void;
  /** 桌面端评分条目态（读：就地打分渲染当前值；key=`${supplierId}:${scoreItemId}`） */
  scores: Record<string, ScoreVal>;
  /** 就地打分回调（scoreItemId + pointId → 写草稿；supplierId 隐含为 panel 的 supplierId） */
  onPointChange?: (scoreItemId: string, pointId: string, value: PointDecisionValue) => void;
  /** 得分点级批注回调（写 points[pointId].note 草稿） */
  onPointNote?: (scoreItemId: string, pointId: string, note: string) => void;
}) {
  const [local, setLocal] = useState<Record<string, BidRequirementReview>>(
    () => Object.fromEntries(reviews.map((r) => [r.requirementId, r])),
  );

  const [isFs, setIsFs] = useState(false);
  const toggleFs = () => setIsFs((f) => !f);
  useEffect(() => {
    if (!isFs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFs]);

  // ── 左栏双模式：「条款清单」（默认） / 「招标文件」（参考视图，不改中/右） ──
  const [leftMode, setLeftMode] = useState<'list' | 'tender'>('list');
  const [tenderPage, setTenderPage] = useState<number | null>(null);

  // C：左栏卡片展开态（clauseId → expanded）；D：右栏 AI判断揭示态 + 批注录入目标
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [aiRevealed, setAiRevealed] = useState<Record<string, boolean>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [annotatingPoint, setAnnotatingPoint] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // D：查找映射到选中条款的得分点（跨评分项），返回 {item, point, clauseCount}
  const linkedPointsOf = (clauseId: string) =>
    scoreItems.flatMap((si) =>
      (si.points ?? [])
        .filter((pt) => (pt.linkedRequirementIds ?? []).includes(clauseId))
        .map((pt) => ({ item: si, point: pt, clauseCount: (pt.linkedRequirementIds ?? []).length })),
    );

  const flat: ReqItem[] = useMemo(
    () => [
      ...(requirements?.qualificationRequirements ?? []).map((r: any) => ({ ...r, category: 'qualification' })),
      ...(requirements?.technicalRequirements ?? []).map((r: any) => ({ ...r, category: 'technical' })),
      ...(requirements?.commercialRequirements ?? []).map((r: any) => ({ ...r, category: 'commercial' })),
    ],
    [requirements],
  );

  // 默认选中第一条（flat 变化——如切供应商——会重置到新的第一条；assist-panel 已用 key=activeSupplier 强制重挂载，这里再加一层保险）
  const [selectedId, setSelectedId] = useState<string>(() => flat[0]?.id ?? '');
  // 若当前选中在 flat 中已不存在（极端时序），回退到第一条
  const effectiveSelectedId = flat.some((i) => i.id === selectedId) ? selectedId : flat[0]?.id ?? '';

  const respBy = (id: string) => responses.find((r) => r.requirementId === id);

  // ── Fix 2：verdict 提交 + 失败回滚（保留 functional update + prevReview 快照）──
  const setVerdict = async (item: ReqItem, verdict: 'ack' | 'dispute' | 'doubt') => {
    const prevReview = local[item.id];
    const next = {
      ...prevReview,
      requirementId: item.id,
      category: item.category,
      verdict,
      note: prevReview?.note ?? '',
    };
    setLocal((cur) => ({ ...cur, [item.id]: next }));
    try {
      await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
        requirementId: item.id,
        category: item.category,
        verdict,
        note: next.note,
      });
    } catch {
      // 回滚到点击前的 verdict —— 否则 UI 显示新值而 server 仍是旧值，专家以为标注成功实为数据丢失
      setLocal((cur) => ({ ...cur, [item.id]: prevReview }));
      /* toast 由全局拦截器处理 */
    }
  };

  // ── Fix 3：note 仅改本地态，onBlur 时 try/catch 提交 ──
  const setNote = (item: ReqItem, note: string) => {
    const verdict = local[item.id]?.verdict ?? 'doubt';
    setLocal((cur) => ({
      ...cur,
      [item.id]: { requirementId: item.id, category: item.category, verdict, note },
    }));
  };
  const saveNote = async (item: ReqItem) => {
    const r = local[item.id];
    if (!r) return;
    try {
      await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
        requirementId: item.id,
        category: item.category,
        verdict: r.verdict,
        note: r.note,
      });
    } catch {
      /* toast 由全局拦截器处理 */
    }
  };

  if (!flat.length) {
    return (
      <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">
        招标条款分析中或暂无条款数据
      </div>
    );
  }

  const selectedItem = flat.find((i) => i.id === effectiveSelectedId) ?? null;
  const selectedResp = selectedItem ? respBy(selectedItem.id) : null;
  const selectedReview = selectedItem ? local[selectedItem.id] : undefined;

  // ── 中栏 iframe src：选中条款变化 → src 更新（Fix 7 解密端点 + #page=N 原生跳页）──
  const iframeSrc =
    selectedResp?.location
      ? `/api/expert/projects/${projectId}/suppliers/${supplierId}/documents/${selectedResp.location.fileId}/download#page=${selectedResp.location.page}`
      : '';

  const grouped = ['qualification', 'technical', 'commercial'] as const;

  return (
    <div className={isFs ? 'fixed inset-0 z-50 space-y-2 bg-[var(--background)] p-4' : 'relative space-y-2'}>
      <button onClick={toggleFs} title={isFs ? '退出全屏' : '全屏'}
        className="neu-btn-xs is-square fixed bottom-4 right-12 z-[60] !h-9 !w-9">
        {isFs ? <Minimize2 size={15} strokeWidth={1.5} /> : <Maximize2 size={15} strokeWidth={1.5} />}
      </button>
      <PanelGroup orientation="horizontal" className="gap-0" style={{ height: isFs ? 'calc(100vh - 32px)' : 'calc(100vh - 150px)', minHeight: '460px' }}>
        {/* ━━━ 左栏 1/4：双模式（tab：条款清单 / 招标原文） ━━━ */}
        <Panel defaultSize={25} minSize={15} className="px-0">
        <aside className="neu-card-static flex h-full flex-col overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2">
            {/* tab 切换：招标文件缺失时隐藏「招标文件」tab */}
            <div className="neu-tab-bar !gap-1 !p-1">
              <button
                onClick={() => setLeftMode('list')}
                className={`neu-tab !px-2.5 !py-1 !text-xs ${leftMode === 'list' ? 'is-active' : ''}`}
              >
                条款清单
              </button>
              {tenderDocUrl && (
                <button
                  onClick={() => setLeftMode('tender')}
                  className={`neu-tab !px-2.5 !py-1 !text-xs ${leftMode === 'tender' ? 'is-active' : ''}`}
                >
                  招标文件
                </button>
              )}
            </div>
            <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
              {leftMode === 'list' ? `· ${flat.length} 条` : '· 原文参考'}
            </span>
          </header>

          {leftMode === 'list' ? (
            /* 模式 1：条款清单（卡片化 + 折叠；按 category 分组，点击选中 → 联动中/右） */
            <div className="flex-1 space-y-3 overflow-y-auto p-2">
              {grouped.map((cat) => {
                const items = flat.filter((i) => i.category === cat);
                if (!items.length) return null;
                const catColor = cat === 'qualification' ? CATEGORY_COLOR['QUALIFICATION']
                  : cat === 'technical' ? CATEGORY_COLOR['TECHNICAL']
                  : CATEGORY_COLOR['BUSINESS'];
                return (
                  <div key={cat}>
                    <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-1.5 border-l-[3px] bg-[oklch(0.985_0.005_258/0.96)] px-2 py-1 backdrop-blur-sm" style={{ borderColor: catColor }}>
                      <span className="text-[11px] font-bold" style={{ color: catColor }}>{CAT_LABEL[cat]}</span>
                      <span className="text-[10px] text-[var(--muted-foreground)]">{items.length}</span>
                      {cat === 'technical' && (
                        <span className="text-[10px] text-[oklch(0.52_0.13_70)]">★ 实质性</span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {items.map((item) => {
                        const isActive = item.id === effectiveSelectedId;
                        const isOpen = !!expanded[item.id];
                        const verdict = local[item.id]?.verdict;
                        const verdictColor = verdict === 'dispute' ? 'var(--danger)' : verdict === 'doubt' ? 'var(--warning)' : verdict === 'ack' ? 'var(--success)' : null;
                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedId(item.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(item.id); } }}
                            className={`cursor-pointer rounded-lg border px-2.5 py-2 transition-colors ${
                              isActive
                                ? 'border-[color-mix(in_oklch,var(--accent-strong)_40%,transparent)] bg-[oklch(0.96_0.03_251/0.18)]'
                                : 'border-[oklch(0.55_0.03_258/0.1)] bg-[oklch(1_0_0/0.5)] hover:bg-[oklch(1_0_0/0.75)]'
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              {/* 进度点：专家标注状态（认可/异议/存疑）；未标注时显★或占位 */}
                              <span className="mt-1 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                {verdictColor ? (
                                  <span className="h-2 w-2 rounded-full" style={{ background: verdictColor }} />
                                ) : item.isStarred ? (
                                  <Star size={11} className="fill-[var(--warning)] text-[var(--warning)]" />
                                ) : null}
                              </span>
                              <p className={`min-w-0 flex-1 text-xs leading-snug ${isActive ? 'font-medium text-[var(--accent-strong)]' : 'text-[var(--foreground)]'} ${isOpen ? '' : 'line-clamp-1'}`}>
                                {item.content}
                              </p>
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpanded((p) => ({ ...p, [item.id]: !p[item.id] })); }}
                                className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[oklch(0.55_0.03_258/0.08)]"
                                title={isOpen ? '收起' : '展开全文'}
                              >
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            </div>
                            {isOpen && (item.acceptanceCriteria || item.threshold) && (
                              <p className="ml-4 mt-1 text-[10px] text-[var(--muted-foreground)]">
                                验收/阈值：{item.acceptanceCriteria || item.threshold}
                              </p>
                            )}
                            {isOpen && item.sourcePage && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setTenderPage(item.sourcePage!); setLeftMode('tender'); }}
                                className="ml-4 mt-1 inline-flex items-center gap-0.5 text-[10px] text-[var(--accent-strong)] hover:underline"
                              >
                                <ExternalLink size={9} /> 原文 p.{item.sourcePage}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 模式 2：招标文件 iframe（参考视图，中/右保持上一个选中条款不动） */
            <div className="flex-1 bg-[oklch(0.97_0.005_264)]">
              <iframe
                key={`tender-p${tenderPage ?? 1}`}
                src={tenderPage ? `${tenderDocUrl}#page=${tenderPage}` : tenderDocUrl}
                title="招标文件原文"
                className="h-full w-full border-0"
                style={{ minHeight: '500px' }}
              />
            </div>
          )}
        </aside>
        </Panel>
        <PanelResizeHandle className="w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent)]/30" />

        {/* ━━━ 中栏 1/2：投标 PDF 内嵌预览 ━━━ */}
        <Panel defaultSize={50} minSize={30} className="px-0">
        <section className="neu-card-static flex h-full flex-col overflow-hidden">
          <header className="flex items-center justify-between px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText size={13} className="shrink-0 text-[var(--accent-strong)]" />
              <span className="truncate text-sm font-bold text-[var(--foreground)]">投标原文</span>
              {selectedResp?.location && (
                <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">· 第 {selectedResp.location.page} 页</span>
              )}
            </div>
            {selectedResp?.location && (
              <a
                href={iframeSrc}
                target="_blank"
                rel="noopener"
                className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--accent-strong)] hover:underline"
              >
                <ExternalLink size={10} /> 新窗口
              </a>
            )}
          </header>
          <div className="flex-1 bg-[oklch(0.97_0.005_264)]">
            {iframeSrc ? (
              <iframe
                key={iframeSrc} // src 变化即重载，确保 #page=N 跳页生效
                src={iframeSrc}
                title="投标文件预览"
                className="h-full w-full border-0"
                style={{ minHeight: '500px' }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
                <AlertCircle size={28} className="mb-2 opacity-60" />
                <p className="text-sm font-medium text-[var(--muted-foreground)]">未定位到投标原文</p>
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  {selectedResp
                    ? 'AI 未能定位本条款对应的投标响应位置，请在原文中手动核对。'
                    : '选中条款后，AI 响应定位的页面将显示于此。'}
                </p>
              </div>
            )}
          </div>
        </section>
        </Panel>
        <PanelResizeHandle className="w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent)]/30" />

        {/* ━━━ 右栏 1/4：AI 响应 + 标注 ━━━ */}
        <Panel defaultSize={25} minSize={15} className="px-0">
        <aside className="neu-card-static flex h-full flex-col overflow-hidden">
          <header className="px-3 py-2">
            <span className="text-sm font-bold text-[var(--foreground)]">响应与标注</span>
          </header>
          {selectedItem ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* 专家标注（上移：专家判断先行） */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted-foreground)]">
                  专家标注
                </div>
                <div className="flex gap-1.5">
                  {VERDICT_CFG.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => setVerdict(selectedItem, v.key)}
                      className={`neu-btn-xs !px-2 !py-1 !text-[11px] ${
                        selectedReview?.verdict === v.key ? `${v.activeCls} ${v.activeBg}` : ''
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                {selectedReview && (
                  <textarea
                    value={selectedReview.note ?? ''}
                    onChange={(e) => setNote(selectedItem, e.target.value)}
                    onBlur={() => saveNote(selectedItem)}
                    placeholder="备注（可选，失焦保存）"
                    rows={3}
                    className="neu-input mt-2 !min-h-[70px] !p-2 !text-[11px]"
                  />
                )}
              </div>

              {/* AI 判断（动作按钮：点击后假装加载 ~1s 再显示，强化「专家调用 AI」语义） */}
              <div className="pt-1">
                {aiLoading[selectedItem.id] ? (
                  <div className="flex items-center gap-1.5 rounded-[10px] bg-[oklch(0.96_0.01_258/0.4)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                    <Loader2 size={12} className="animate-spin text-[var(--accent-strong)]" /> AI 分析中…
                  </div>
                ) : !aiRevealed[selectedItem.id] ? (
                  <button
                    onClick={() => {
                      setAiLoading((p) => ({ ...p, [selectedItem.id]: true }));
                      setTimeout(() => {
                        setAiLoading((p) => ({ ...p, [selectedItem.id]: false }));
                        setAiRevealed((p) => ({ ...p, [selectedItem.id]: true }));
                      }, 900 + Math.random() * 500);
                    }}
                    className="neu-btn-xs !gap-1 !text-[11px]"
                    title="查看 AI 对本条款的判断（仅供参考）"
                  >
                    <Sparkles size={12} /> AI 判断
                  </button>
                ) : (
                  <div className="rounded-[10px] bg-[oklch(0.96_0.01_258/0.4)] p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[var(--muted-foreground)]"><Sparkles size={10} className="mr-1 inline" />AI 判断（仅供参考）</span>
                      <button
                        onClick={() => setAiRevealed((p) => ({ ...p, [selectedItem.id]: false }))}
                        className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        收起
                      </button>
                    </div>
                    {selectedResp ? (
                      (() => {
                        const sc = STATUS_CFG[selectedResp.status];
                        return (
                          <>
                            <span className="exp-pill !gap-1" style={{ '--c': sc.c } as React.CSSProperties}>
                              <sc.icon size={11} /> {sc.label}
                            </span>
                            {selectedResp.excerpt && (
                              <div className="mt-2">
                                <p className="text-[11px] italic leading-relaxed text-[var(--muted-foreground)]">
                                  “{selectedResp.excerpt}”
                                </p>
                                {selectedResp.verified === false && (
                                  <p className="mt-1 flex items-center gap-0.5 text-[10px] text-[oklch(0.52_0.13_70)] not-italic">
                                    <AlertCircle size={10} /> AI 摘录未在标书中复核通过，请手动核对
                                  </p>
                                )}
                                {selectedResp.pageCorrected && (
                                  <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)] not-italic">· 页码已自动修正</p>
                                )}
                              </div>
                            )}
                            {!selectedResp.location && (
                              <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">（未定位到投标原文页码）</p>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      <span className="text-[10px] text-[var(--muted-foreground)]">AI 响应定位中</span>
                    )}
                  </div>
                )}
              </div>

              {/* 相关评分项（基数驱动：1:1 就地打分 / N:1 仅批注 / 通过性项只读 / 未映射同类别只读） */}
              <div className="pt-1">
                <hr className="wb-section-rule mb-2" />
                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted-foreground)]">
                  相关评分项
                </div>
                {(() => {
                  const linked = linkedPointsOf(selectedItem.id);
                  const linkedItemIds = new Set(linked.map((l) => l.item.id));
                  const grouped = new Map<string, { si: BidScoreItem; pts: Array<{ pt: NonNullable<BidScoreItem['points']>[number]; clauseCount: number }> }>();
                  for (const l of linked) {
                    const e = grouped.get(l.item.id);
                    if (e) e.pts.push({ pt: l.point, clauseCount: l.clauseCount });
                    else grouped.set(l.item.id, { si: l.item, pts: [{ pt: l.point, clauseCount: l.clauseCount }] });
                  }
                  return (
                    <div className="space-y-2">
                      {/* 精确映射项（可操作） */}
                      {[...grouped.values()].map(({ si, pts }) => {
                        const key = `${supplierId}:${si.id}`;
                        const cur = scores[key];
                        const passFail = isPassFailCategory(si.category);
                        // G：通过性项不在此操作（异议回路覆盖），仅显只读行
                        if (passFail) {
                          return (
                            <div key={si.id} className="rounded-[10px] bg-[oklch(1_0_0/0.55)] px-2.5 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--foreground)]" title={si.name}>{si.name}</span>
                                <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]">通过性·异议回路</span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={si.id} className="rounded-[10px] bg-[oklch(1_0_0/0.55)] px-2.5 py-2">
                            <div className="mb-1.5 flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--foreground)]" title={si.name}>{si.name}</span>
                              <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]">满分 {Number(si.maxScore)}</span>
                            </div>
                            <div className="space-y-1.5">
                              {pts.map(({ pt, clauseCount }) => {
                                const ptId = `${si.id}:${pt.id}`;
                                const sole = clauseCount === 1;
                                const existingNote = cur?.points?.[pt.id]?.note ?? '';
                                return (
                                  <div key={pt.id}>
                                    {sole ? (
                                      // 1:1 就地打分（草稿）
                                      <PointChecklistScoring
                                        points={[{ id: pt.id, name: pt.name, fullScore: pt.fullScore, objective: pt.objective, evidenceHint: pt.evidenceHint, seq: pt.seq }]}
                                        value={cur?.points ?? {}}
                                        onChange={(pid, pv) => onPointChange?.(si.id, pid, pv)}
                                        hideNotes
                                      />
                                    ) : (
                                      // N:1 仅提示（不可单条打分）
                                      <div className="rounded-[8px] bg-[oklch(0.96_0.01_258/0.4)] px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]">
                                        {pt.name} · 需综合 {clauseCount} 条条款，请去打分页汇总
                                      </div>
                                    )}
                                    {/* 批注（得分点级 note）：1:1 可选 / N:1 主要手段 */}
                                    <div className="mt-1">
                                      {annotatingPoint === ptId ? (
                                        <textarea
                                          autoFocus
                                          value={noteDraft}
                                          onChange={(e) => setNoteDraft(e.target.value)}
                                          onBlur={() => { onPointNote?.(si.id, pt.id, noteDraft); setAnnotatingPoint(null); }}
                                          placeholder="批注写入打分备注（失焦保存）"
                                          rows={2}
                                          className="neu-input !min-h-[44px] !p-1.5 !text-[10px]"
                                        />
                                      ) : (
                                        <button
                                          onClick={() => { setAnnotatingPoint(ptId); setNoteDraft(existingNote); }}
                                          className={`inline-flex items-center gap-0.5 text-[10px] hover:underline ${existingNote ? 'text-[var(--accent-strong)]' : 'text-[var(--muted-foreground)]'}`}
                                        >
                                          <MessageSquarePlus size={10} /> {existingNote ? '批注已写' : '批注'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* 同类别其余项（只读指引） */}
                      {(() => {
                        const cats = selectedItem.isStarred
                          ? [...(CAT_TO_SCORE[selectedItem.category] ?? []), 'RESPONSIVE']
                          : (CAT_TO_SCORE[selectedItem.category] ?? []);
                        const others = scoreItems.filter((si) => cats.includes(si.category) && !linkedItemIds.has(si.id));
                        if (others.length === 0) return null;
                        return (
                          <div className="space-y-1 pt-1">
                            <div className="text-[9px] text-[var(--muted-foreground)]">同类别其他项</div>
                            {others.map((si) => {
                              const st = scoreStatus[si.id];
                              const passFail = isPassFailCategory(si.category);
                              return (
                                <div key={si.id} className="flex items-center gap-1.5 rounded-[8px] bg-[oklch(1_0_0/0.35)] px-2 py-1">
                                  <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--foreground)]" title={si.name}>{si.name}</span>
                                  {st?.state === 'committed' ? (
                                    <span className="shrink-0 text-[9px] text-[var(--success)]">
                                      {passFail ? (st.passed === true ? '通过' : st.passed === false ? '不通过' : '已提交') : `${st.score}分`}
                                    </span>
                                  ) : st?.state === 'draft' ? (
                                    <span className="shrink-0 text-[9px] text-[var(--warning)]">草稿{!passFail && st.score > 0 ? ` ${st.score}` : ''}</span>
                                  ) : (
                                    <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]">未填</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
                <button
                  onClick={() => {
                    const linked = linkedPointsOf(selectedItem.id).find((l) => !isPassFailCategory(l.item.category));
                    onGoScoring(linked ? { scoreItemId: linked.item.id, pointId: linked.point.id } : undefined);
                  }}
                  className="neu-btn-soft mt-2 w-full !h-8 !text-[11px]"
                >
                  <Edit3 size={12} strokeWidth={1.5} /> 去打分平板
                </button>
                <p className="mt-1 text-center text-[9px] text-[var(--muted-foreground)]">
                  1:1 映射可就地打分（草稿）· N:1 仅批注 · 通过性项走异议回路
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[10px] text-[var(--muted-foreground)]">
              请在左侧选择条款
            </div>
          )}
        </aside>
        </Panel>
      </PanelGroup>

      <p className="text-center text-[10px] text-[var(--muted-foreground)]">
        标注仅本人可见；异议将在评审报告中披露，并在打分页提示核对。
      </p>
    </div>
  );
}
