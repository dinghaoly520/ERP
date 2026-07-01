// requirement-compare-panel.tsx
'use client';
import { useMemo, useState } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle, FileText } from 'lucide-react';
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
}

const CAT_LABEL: Record<string, string> = {
  qualification: '资格要求',
  technical: '技术要求',
  commercial: '商务要求',
};

const STATUS_CFG: Record<string, { label: string; color: string; badge: string; icon: any }> = {
  met: { label: '满足', color: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
  partial: { label: '部分', color: 'text-amber-600', badge: 'bg-amber-100 text-amber-700 border-amber-200', icon: HelpCircle },
  unmet: { label: '不满足', color: 'text-red-600', badge: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
  not_found: { label: '未提及', color: 'text-[oklch(0.55_0.01_264)]', badge: 'bg-[oklch(0.96_0.004_264)] text-[oklch(0.45_0.01_264)] border-[oklch(0.91_0.006_264)]', icon: AlertCircle },
};

const VERDICT_CFG: { key: 'ack' | 'dispute' | 'doubt'; label: string; active: string }[] = [
  { key: 'ack', label: '认可', active: 'bg-emerald-100 border-emerald-300 text-emerald-700' },
  { key: 'dispute', label: '异议', active: 'bg-red-100 border-red-300 text-red-700' },
  { key: 'doubt', label: '存疑', active: 'bg-amber-100 border-amber-300 text-amber-700' },
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

  // ── 左栏双模式：「条款清单」（默认） / 「招标文件」（参考视图，不改中/右） ──
  const [leftMode, setLeftMode] = useState<'list' | 'tender'>('list');

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
      <div className="text-center py-6 text-xs text-[oklch(0.55_0.01_264)]">
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
    <div className="space-y-2">
      <PanelGroup orientation="horizontal" className="gap-0" style={{ height: 'calc(100vh - 280px)', minHeight: '460px' }}>
        {/* ━━━ 左栏 1/4：双模式（tab：条款清单 / 招标原文） ━━━ */}
        <Panel defaultSize={25} minSize={15} className="px-0">
        <aside className="glass-card glass-card-lighter rounded-xl overflow-hidden flex flex-col h-full">
          <header className="px-3 py-2 border-b border-[oklch(0.91_0.006_264)] bg-white/50">
            {/* tab 切换：招标文件缺失时隐藏「招标文件」tab */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLeftMode('list')}
                className={`text-sm font-bold transition-colors ${
                  leftMode === 'list'
                    ? 'text-[var(--color-primary)]'
                    : 'text-[oklch(0.55_0.01_264)] hover:text-[var(--color-text)]'
                }`}
              >
                条款清单
              </button>
              {tenderDocUrl && (
                <button
                  onClick={() => setLeftMode('tender')}
                  className={`text-sm font-bold transition-colors ${
                    leftMode === 'tender'
                      ? 'text-[var(--color-primary)]'
                      : 'text-[oklch(0.55_0.01_264)] hover:text-[var(--color-text)]'
                  }`}
                >
                  招标文件
                </button>
              )}
              <span className="ml-auto text-[10px] text-[oklch(0.55_0.01_264)]">
                {leftMode === 'list' ? `· ${flat.length} 条` : '· 原文参考'}
              </span>
            </div>
          </header>

          {leftMode === 'list' ? (
            /* 模式 1：条款清单（按 category 分组，点击选中 → 联动中/右） */
            <div className="flex-1 overflow-y-auto divide-y divide-[oklch(0.94_0.004_264)]">
              {grouped.map((cat) => {
                const items = flat.filter((i) => i.category === cat);
                if (!items.length) return null;
                return (
                  <div key={cat}>
                    <div className="sticky top-0 px-3 py-1.5 bg-[oklch(0.97_0.005_264)]/95 backdrop-blur-sm border-b border-[oklch(0.91_0.006_264)]">
                      <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                        {CAT_LABEL[cat]}
                      </span>
                      {cat === 'technical' && (
                        <span className="text-[10px] text-amber-600 ml-1">★ 实质性</span>
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
                          className={`w-full text-left px-3 py-2 flex items-start gap-1.5 transition-colors border-l-2 ${
                            isActive
                              ? 'bg-[var(--color-primary-light)] border-[var(--color-primary)]'
                              : 'border-transparent hover:bg-white/60'
                          }`}
                        >
                          {item.isStarred ? (
                            <Star size={12} className="text-amber-500 fill-amber-400 shrink-0 mt-0.5" />
                          ) : (
                            <span className="w-3 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs leading-snug line-clamp-2 ${isActive ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)]'}`}>
                              {item.content}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {sc ? (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] ${sc.color}`}>
                                  <sc.icon size={10} /> {sc.label}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[oklch(0.55_0.01_264)]">AI 定位中</span>
                              )}
                              {local[item.id]?.verdict === 'dispute' && (
                                <span className="text-[10px] text-red-600">·异议</span>
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
                src={tenderDocUrl}
                title="招标文件原文"
                className="w-full h-full border-0"
                style={{ minHeight: '500px' }}
              />
            </div>
          )}
        </aside>
        </Panel>
        <PanelResizeHandle className="w-1.5 bg-transparent hover:bg-[var(--color-primary)]/30 cursor-col-resize transition-colors" />

        {/* ━━━ 中栏 1/2：投标 PDF 内嵌预览 ━━━ */}
        <Panel defaultSize={50} minSize={30} className="px-0">
        <section className="glass-card glass-card-lighter rounded-xl overflow-hidden flex flex-col h-full">
          <header className="px-3 py-2 border-b border-[oklch(0.91_0.006_264)] bg-white/50 flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText size={13} className="text-[var(--color-primary)] shrink-0" />
              <span className="font-bold text-sm text-[var(--color-text)] truncate">投标原文</span>
              {selectedResp?.location && (
                <span className="text-[10px] text-[oklch(0.55_0.01_264)] shrink-0">· 第 {selectedResp.location.page} 页</span>
              )}
            </div>
            {selectedResp?.location && (
              <a
                href={iframeSrc}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-primary)] hover:underline shrink-0"
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
                className="w-full h-full border-0"
                style={{ minHeight: '500px' }}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
                <AlertCircle size={28} className="text-[oklch(0.62_0.008_264)] mb-2" />
                <p className="text-sm text-[var(--color-text-secondary)] font-medium">未定位到投标原文</p>
                <p className="text-[11px] text-[oklch(0.55_0.01_264)] mt-1">
                  {selectedResp
                    ? 'AI 未能定位本条款对应的投标响应位置，请在原文中手动核对。'
                    : '选中条款后，AI 响应定位的页面将显示于此。'}
                </p>
              </div>
            )}
          </div>
        </section>
        </Panel>
        <PanelResizeHandle className="w-1.5 bg-transparent hover:bg-[var(--color-primary)]/30 cursor-col-resize transition-colors" />

        {/* ━━━ 右栏 1/4：AI 响应 + 标注 ━━━ */}
        <Panel defaultSize={25} minSize={25} maxSize={25} className="px-0">
        <aside className="glass-card glass-card-lighter rounded-xl overflow-hidden flex flex-col h-full">
          <header className="px-3 py-2 border-b border-[oklch(0.91_0.006_264)] bg-white/50">
            <span className="font-bold text-sm text-[var(--color-text)]">响应与标注</span>
          </header>
          {selectedItem ? (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* 选中条款全文 */}
              <div>
                <div className="flex items-start gap-1.5">
                  {selectedItem.isStarred && (
                    <Star size={12} className="text-amber-500 fill-amber-400 shrink-0 mt-0.5" />
                  )}
                  <p className="text-xs text-[var(--color-text)] leading-relaxed">{selectedItem.content}</p>
                </div>
                {(selectedItem.acceptanceCriteria || selectedItem.threshold) && (
                  <p className="text-[10px] text-[oklch(0.55_0.01_264)] mt-1 ml-5">
                    验收/阈值：{selectedItem.acceptanceCriteria || selectedItem.threshold}
                  </p>
                )}
              </div>

              {/* AI 响应 */}
              <div className="pt-2 border-t border-[oklch(0.94_0.004_264)]">
                <div className="text-[10px] text-[oklch(0.55_0.01_264)] mb-1.5 font-semibold tracking-wide">
                  AI 响应
                </div>
                {selectedResp ? (
                  (() => {
                    const sc = STATUS_CFG[selectedResp.status];
                    return (
                      <>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${sc.badge}`}>
                          <sc.icon size={11} /> {sc.label}
                        </span>
                        {selectedResp.excerpt && (
                          <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 leading-relaxed italic">
                            “{selectedResp.excerpt}”
                          </p>
                        )}
                        {!selectedResp.location && (
                          <p className="text-[10px] text-[oklch(0.55_0.01_264)] mt-2">（未定位到投标原文页码）</p>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <span className="text-[10px] text-[oklch(0.55_0.01_264)]">AI 响应定位中</span>
                )}
              </div>

              {/* 标注 */}
              <div className="pt-2 border-t border-[oklch(0.94_0.004_264)]">
                <div className="text-[10px] text-[oklch(0.55_0.01_264)] mb-1.5 font-semibold tracking-wide">
                  专家标注
                </div>
                <div className="flex gap-1.5">
                  {VERDICT_CFG.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => setVerdict(selectedItem, v.key)}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                        selectedReview?.verdict === v.key
                          ? v.active
                          : 'border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] hover:bg-white/60'
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
                    className="mt-2 w-full text-[11px] px-2 py-1.5 rounded border border-[oklch(0.91_0.006_264)] bg-white/70 resize-none focus:outline-none focus:border-[var(--color-primary)] tabular-nums"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[10px] text-[oklch(0.55_0.01_264)]">
              请在左侧选择条款
            </div>
          )}
        </aside>
        </Panel>
      </PanelGroup>

      <p className="text-[10px] text-[oklch(0.55_0.01_264)] text-center">
        标注仅本人可见；异议将在评审报告中披露，并在打分页提示核对。
      </p>
    </div>
  );
}
