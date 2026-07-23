// requirement-compare-panel.tsx
'use client';
import { useMemo, useState, useEffect } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle, FileText, Maximize2, Minimize2 } from 'lucide-react';
import type { RequirementResponse, BidRequirementReview } from '@water-erp/shared';
import { api } from '@/lib/api';

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
}: {
  projectId: string;
  supplierId: string;
  requirements: any;
  responses: RequirementResponse[];
  reviews: BidRequirementReview[];
  /** 招标文件解密下载 URL（模式 2 iframe src）；为空时隐藏「招标文件」tab */
  tenderDocUrl?: string;
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
            /* 模式 1：条款清单（按 category 分组，点击选中 → 联动中/右） */
            <div className="flex-1 overflow-y-auto divide-y divide-[oklch(0.55_0.03_258/0.06)]">
              {grouped.map((cat) => {
                const items = flat.filter((i) => i.category === cat);
                if (!items.length) return null;
                return (
                  <div key={cat}>
                    <div className="sticky top-0 bg-[oklch(0.985_0.005_258/0.95)] px-3 py-1.5 backdrop-blur-sm">
                      <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                        {CAT_LABEL[cat]}
                      </span>
                      {cat === 'technical' && (
                        <span className="ml-1 text-[10px] text-[oklch(0.52_0.13_70)]">★ 实质性</span>
                      )}
                    </div>
                    {items.map((item) => {
                      const isActive = item.id === effectiveSelectedId;
                      const resp = respBy(item.id);
                      const sc = resp ? STATUS_CFG[resp.status] : null;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          className={`flex w-full items-start gap-1.5 px-3 py-2 text-left transition-colors ${
                            isActive
                              ? 'bg-[oklch(0.96_0.03_251/0.28)] shadow-[inset_2px_0_0_var(--accent-strong)]'
                              : 'hover:bg-[oklch(1_0_0/0.45)]'
                          }`}
                        >
                          {item.isStarred ? (
                            <Star size={12} className="mt-0.5 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />
                          ) : (
                            <span className="w-3 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`line-clamp-2 text-xs leading-snug ${isActive ? 'font-medium text-[var(--accent-strong)]' : 'text-[var(--foreground)]'}`}>
                              {item.content}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1">
                              {sc ? (
                                <span className="exp-pill !gap-1 !px-1.5 !py-0 !text-[10px]" style={{ '--c': sc.c } as React.CSSProperties}>
                                  <sc.icon size={10} /> {sc.label}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[var(--muted-foreground)]">AI 定位中</span>
                              )}
                              {local[item.id]?.verdict === 'dispute' && (
                                <span className="text-[10px] text-[var(--danger)]">·异议</span>
                              )}
                              {item.sourcePage && (
                                <span role="button" tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); setTenderPage(item.sourcePage!); setLeftMode('tender'); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setTenderPage(item.sourcePage!); setLeftMode('tender'); } }}
                                  title={`跳转到招标文件第 ${item.sourcePage} 页`}
                                  className="ml-auto shrink-0 cursor-pointer text-[10px] text-[var(--accent-strong)] hover:underline"
                                >
                                  原文 p.{item.sourcePage}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
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
              {/* 选中条款全文 */}
              <div>
                <div className="flex items-start gap-1.5">
                  {selectedItem.isStarred && (
                    <Star size={12} className="mt-0.5 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />
                  )}
                  <p className="text-xs leading-relaxed text-[var(--foreground)]">{selectedItem.content}</p>
                </div>
                {(selectedItem.acceptanceCriteria || selectedItem.threshold) && (
                  <p className="ml-5 mt-1 text-[10px] text-[var(--muted-foreground)]">
                    验收/阈值：{selectedItem.acceptanceCriteria || selectedItem.threshold}
                  </p>
                )}
              </div>

              {/* AI 响应 */}
              <div className="pt-2">
                <hr className="wb-section-rule mb-2" />
                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted-foreground)]">
                  AI 响应
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

              {/* 标注 */}
              <div className="pt-2">
                <hr className="wb-section-rule mb-2" />
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
