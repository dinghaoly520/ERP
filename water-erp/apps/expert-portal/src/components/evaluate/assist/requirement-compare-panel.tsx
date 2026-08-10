// requirement-compare-panel.tsx
'use client';
import { useMemo, useState, useEffect } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle, FileText, Maximize2, Minimize2, Edit3, ChevronRight, ChevronDown, Sparkles, Loader2, Gavel, BarChart3 } from 'lucide-react';
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

const VERDICT_CFG: { key: 'dispute' | 'doubt'; label: string; activeCls: string; activeBg: string }[] = [
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

  // 评分进度仪表盘：按类别展开态
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const toggleCat = (cat: string) => setExpandedCats(prev => {
    const n = new Set(prev);
    if (n.has(cat)) n.delete(cat); else n.add(cat);
    return n;
  });

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

  // 自动展开选中条款对应的评分类别（须在 early return 之前——Rules of Hooks）
  useEffect(() => {
    if (!effectiveSelectedId) return;
    const item = flat.find(i => i.id === effectiveSelectedId);
    if (!item) return;
    const cats = item.isStarred
      ? [...(CAT_TO_SCORE[item.category] ?? []), 'RESPONSIVE']
      : (CAT_TO_SCORE[item.category] ?? []);
    if (cats.length === 0) return;
    setExpandedCats(prev => {
      const n = new Set(prev);
      for (const c of cats) n.add(c);
      return n;
    });
  }, [effectiveSelectedId]);

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
    <div className={isFs ? 'fixed inset-0 z-50 space-y-2 bg-[var(--background)] p-4' : 'relative space-y-2 overflow-hidden'}>
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

        {/* ━━━ 右栏 1/4：响应与标注（cgzxui 重构：三区分隔——专家标注凸起 / AI 判断浅底 / 评分项平铺） ━━━ */}
        <Panel defaultSize={25} minSize={15} className="px-0">
        <aside className="neu-card-static flex h-full flex-col overflow-hidden">
          {/* 头部：选中条款上下文（类别 chip + 截断内容） */}
          <header className="shrink-0 border-b border-[oklch(0.6_0.04_258/0.12)] px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <FileText size={13} strokeWidth={1.5} className="shrink-0 text-[var(--accent-strong)]" />
              <span className="text-sm font-bold text-[var(--foreground)]">响应与标注</span>
            </div>
          </header>

          {selectedItem ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* ── ① 专家标注（主动作区：凸起容器）── */}
              <section className="exp-category-group !p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Gavel size={12} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                  <span className="text-[10px] font-bold tracking-wide text-[var(--foreground)]">专家标注</span>
                  <span className="wb-section-rule ml-1 flex-1" />
                </div>
                <div className="flex gap-1.5">
                  {VERDICT_CFG.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => setVerdict(selectedItem, v.key)}
                      className={`neu-btn-xs flex-1 !px-2 !py-1.5 !text-[11px] ${
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
                    className="neu-input mt-2 !min-h-[64px] !p-2 !text-[11px]"
                  />
                )}
              </section>

              {/* ── ② AI 判断（参考区：浅底区分，视觉上从属于专家判断）── */}
              <section className="rounded-[14px] bg-[oklch(0.96_0.01_258/0.3)] p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles size={12} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                  <span className="text-[10px] font-bold tracking-wide text-[var(--muted-foreground)]">AI 判断</span>
                  <span className="rounded bg-[oklch(0.52_0.13_251/0.1)] px-1 py-px text-[8px] font-bold text-[var(--accent)]">仅供参考</span>
                  <span className="wb-section-rule ml-1 flex-1" />
                </div>
                {aiLoading[selectedItem.id] ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
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
                    className="neu-btn-xs justify-center !px-2 !py-1.5 !text-[11px]"
                    style={{ width: 'calc(50% - 3px)' }}
                    title="查看 AI 对本条款的判断（仅供参考）"
                  >
                    查看
                  </button>
                ) : (
                  <div>
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
                    <button
                      onClick={() => setAiRevealed((p) => ({ ...p, [selectedItem.id]: false }))}
                      className="mt-2 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      收起 ↑
                    </button>
                  </div>
                )}
              </section>

              {/* ── ③ 评分进度仪表盘（类别进度条 + 通过性就地打分 + 非通过性只读）── */}
              <section>
                <div className="mb-2 flex items-center gap-1.5">
                  <BarChart3 size={12} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                  <span className="text-[10px] font-bold tracking-wide text-[var(--foreground)]">评分进度</span>
                  <span className="wb-section-rule ml-1 flex-1" />
                </div>
                {(() => {
                  const ALL_CATS = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'] as const;
                  // 计算每类别进度（得分点粒度）
                  const catData = ALL_CATS.map(cat => {
                    const items = scoreItems.filter(si => si.category === cat);
                    let done = 0, total = 0;
                    for (const si of items) {
                      const pts = si.points ?? [];
                      total += pts.length;
                      const key = `${supplierId}:${si.id}`;
                      const cur = scores[key];
                      const st = scoreStatus[si.id];
                      if (st?.state === 'committed') {
                        done += pts.length;
                      } else if (cur?.points && Object.keys(cur.points).length > 0) {
                        done += Object.keys(cur.points).length;
                      } else if (cur?.passed === true && isPassFailCategory(cat)) {
                        done += pts.filter(p => p.objective).length;
                      }
                    }
                    return { cat, items, done, total };
                  });
                  const totalDone = catData.reduce((s, c) => s + c.done, 0);
                  const totalAll = catData.reduce((s, c) => s + c.total, 0);

                  return (
                    <div className="space-y-1.5">
                      {/* 总进度 */}
                      <div className="mb-1 flex items-center justify-between text-[10px]">
                        <span className="text-[var(--muted-foreground)]">总进度</span>
                        <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">{totalDone} / {totalAll}</span>
                      </div>

                      {/* 按类别进度条 */}
                      {catData.map(({ cat, items, done, total }) => {
                        if (items.length === 0) return null;
                        const catColor = CATEGORY_COLOR[cat] || 'var(--accent-strong)';
                        const catLabel = CATEGORY_LABEL[cat] || cat;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        const isExpanded = expandedCats.has(cat);
                        const passFail = isPassFailCategory(cat);
                        return (
                          <div key={cat}>
                            {/* 类别行：chip + 名称 + 进度条 + 数字 */}
                            <button
                              type="button"
                              onClick={() => toggleCat(cat)}
                              className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition hover:bg-[oklch(0.96_0.01_258/0.4)]"
                            >
                              {isExpanded
                                ? <ChevronDown size={11} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                                : <ChevronRight size={11} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />}
                              <span className="exp-category-chip !h-2 !w-2 shrink-0" style={{ '--cat': catColor } as React.CSSProperties} />
                              <span className="w-14 shrink-0 truncate text-[10px] font-semibold text-[var(--foreground)]">{catLabel}</span>
                              {/* 进度条 */}
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(0.9_0.01_258/0.6)]">
                                <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: catColor }} />
                              </span>
                              <span className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-[var(--muted-foreground)]">{done}/{total}</span>
                            </button>

                            {/* 展开内容 */}
                            {isExpanded && (
                              <div className="ml-4 space-y-1.5 pb-1">
                                {items.map(si => {
                                  const key = `${supplierId}:${si.id}`;
                                  const cur = scores[key];
                                  const st = scoreStatus[si.id];

                                  if (passFail) {
                                    // 通过性项：就地打分（PointChecklistScoring compact）
                                    const siPoints = (si.points ?? []).map(p => ({ id: p.id, name: p.name, fullScore: p.fullScore, objective: p.objective, evidenceHint: p.evidenceHint, seq: p.seq }));
                                    // effective value：先看 points 存储，无则从 passed 回退
                                    const valueMap: Record<string, PointDecisionValue> = {};
                                    for (const pt of siPoints) {
                                      const stored = cur?.points?.[pt.id];
                                      if (stored) valueMap[pt.id] = stored;
                                      else if (cur?.passed === true) valueMap[pt.id] = { checked: true, awardedScore: Number(pt.fullScore) };
                                      else valueMap[pt.id] = { checked: false, awardedScore: 0 };
                                    }
                                    // 计算 passed 状态（用于 badge）
                                    const objectivePts = siPoints.filter(p => p.objective);
                                    const allChecked = objectivePts.length > 0 && objectivePts.every(p => valueMap[p.id]?.checked === true);
                                    const anyUnchecked = objectivePts.some(p => valueMap[p.id]?.checked === false);
                                    const passedDisplay = st?.state === 'committed' ? st.passed : (allChecked ? true : anyUnchecked ? false : undefined);

                                    return (
                                      <div key={si.id} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(1_0_0/0.35)] px-2 py-1.5">
                                        <div className="mb-1 flex items-center gap-1">
                                          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[var(--foreground)]" title={si.name}>{si.name}</span>
                                          {passedDisplay === true && <span className="shrink-0 text-[9px] font-bold text-[var(--success)]">通过</span>}
                                          {passedDisplay === false && <span className="shrink-0 text-[9px] font-bold text-[var(--danger)]">不通过</span>}
                                          {passedDisplay === undefined && st?.state !== 'committed' && <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]">未评</span>}
                                        </div>
                                        {siPoints.length > 0 && (
                                          <PointChecklistScoring
                                            points={siPoints}
                                            value={valueMap}
                                            onChange={(pid, pv) => onPointChange?.(si.id, pid, pv)}
                                            compact
                                            hideNotes
                                          />
                                        )}
                                      </div>
                                    );
                                  }

                                  // 非通过性项：只读状态 + 点击跳平板
                                  return (
                                    <div
                                      key={si.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => {
                                        const firstPt = (si.points ?? [])[0];
                                        onGoScoring(firstPt ? { scoreItemId: si.id, pointId: firstPt.id } : { scoreItemId: si.id });
                                      }}
                                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoScoring({ scoreItemId: si.id }); } }}
                                      className="flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-[oklch(1_0_0/0.25)] px-2 py-1 transition hover:bg-[oklch(0.96_0.01_258/0.4)]"
                                    >
                                      <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--foreground)]" title={si.name}>{si.name}</span>
                                      {st?.state === 'committed' ? (
                                        <span className="shrink-0 text-[9px] text-[var(--success)]">{st.score}分</span>
                                      ) : st?.state === 'draft' ? (
                                        <span className="shrink-0 text-[9px] text-[var(--warning)]">草稿 {st.score}</span>
                                      ) : (
                                        <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]">未填</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <button
                        onClick={() => onGoScoring()}
                        className="neu-btn-soft mt-2 w-full !h-8 !text-[11px]"
                      >
                        <Edit3 size={12} strokeWidth={1.5} /> 去打分平板
                      </button>
                    </div>
                  );
                })()}
              </section>
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
