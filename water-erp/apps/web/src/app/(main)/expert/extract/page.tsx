'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listBidProjects, previewExtraction, confirmExtraction, sendExtractionNotify, getExtractionHistory, listSpecialties, listExperts, getBidProjectDetail, type BidProjectOption, type BidProjectDetail, type ExtractionPreview, type CandidatePoolItem, type ExtractionSelected } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { STAGE_LABEL } from '@water-erp/shared';
import { Sparkles, ShieldCheck, AlertTriangle, Check, X, RefreshCw, UsersRound, MessageSquare, Phone, Bell, Pencil, Plus, Clock, FileText, UserCircle } from 'lucide-react';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
interface SpecialtyQuota { specialty: string; count: number; }

type ExtractMode = 'specialty_match' | 'random' | 'merit_best';
const MODE_LABELS: Record<ExtractMode, string> = { specialty_match: '专业匹配', random: '随机抽取', merit_best: '综合择优' };
const MODE_DESCS: Record<ExtractMode, string> = {
  specialty_match: 'AI 分析项目专业需求，按专业匹配度加权推荐',
  random: '合规池公平随机，确保专家均等中选机会',
  merit_best: '综合履职评价/偏离度/经验等多维度择优',
};

export function ExpertExtractPage({ hideHeader }: { hideHeader?: boolean }) {
  const router = useRouter(); const q = useSearchParams();
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [pid, setPid] = useState(q.get('projectId') || '');
  const [pd, setPd] = useState<BidProjectDetail | null>(null);
  const [pool, setPool] = useState<Map<string, number>>(new Map());
  const [tn, setTn] = useState(5); const [alt, setAlt] = useState(2);
  const [extractMode, setExtractMode] = useState<ExtractMode>('specialty_match');
  const [quotas, setQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);
  const [loading, setLoading] = useState(false); const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''); const [preview, setPreview] = useState<ExtractionPreview | null>(null); const [done, setDone] = useState(false);
  // 对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [compareMode2, setCompareMode2] = useState<ExtractMode>('merit_best');
  const [compareResult2, setCompareResult2] = useState<ExtractionPreview | null>(null);
  // 手动调整后的名单
  const [selectedExperts, setSelectedExperts] = useState<ExtractionSelected[]>([]);
  const [alternativeExperts, setAlternativeExperts] = useState<ExtractionSelected[]>([]);
  // 替换弹窗
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<{ index: number; role: 'selected' | 'alternative' } | null>(null);
  const [replaceSearch, setReplaceSearch] = useState('');
  // 通知弹窗
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyChannels, setNotifyChannels] = useState<string[]>(['in_app']);
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifying, setNotifying] = useState(false);
  const [notifyResults, setNotifyResults] = useState<any>(null);
  const [confirmedExpertIds, setConfirmedExpertIds] = useState<string[]>([]);
  // 抽取历史弹窗
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<{ total: number; page: number; pageSize: number; items: any[] } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => { listBidProjects().then(setProjects).catch(() => {}); listSpecialties().then(setSpecs).catch(() => {}); }, []);
  useEffect(() => { if (!pid) { setPd(null); return; } getBidProjectDetail(pid).then(setPd).catch(() => setPd(null)); }, [pid]);
  useEffect(() => { if (!pid || specs.length === 0) return; Promise.all(specs.map(s => listExperts({ specialty: s }).then(l => ({ s, c: Array.isArray(l) ? l.length : 0 })))).then(rs => { const m = new Map<string, number>(); rs.forEach(({ s, c }) => { if (c > 0) m.set(s, c); }); setPool(m); }).catch(() => {}); }, [pid, specs]);

  const sel = useMemo(() => projects.find(p => p.id === pid), [projects, pid]);
  const addQ = () => setQuotas(p => [...p, { specialty: '', count: 1 }]);
  const rmQ = (i: number) => { if (quotas.length <= 1) return; setQuotas(p => p.filter((_, x) => x !== i)); };
  const upQ = (i: number, f: keyof SpecialtyQuota, v: string | number) => setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q));
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = extractMode === 'specialty_match' ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = extractMode === 'specialty_match' ? Math.max(qt, 1) : tn;
  const hasResults = preview !== null || loading || done;

  // 候选池去重（排除已在正选/候补名单中的）
  const availablePool = useMemo(() => {
    if (!preview?.candidatePool) return [];
    const used = new Set([...selectedExperts.map(e => e.userId), ...alternativeExperts.map(e => e.userId)]);
    return preview.candidatePool.filter(c => !used.has(c.userId));
  }, [preview, selectedExperts, alternativeExperts]);

  const filteredPool = useMemo(() =>
    availablePool.filter(c =>
      !replaceSearch.trim() ||
      c.name.includes(replaceSearch.trim()) ||
      c.specialty.includes(replaceSearch.trim())
    ),
  [availablePool, replaceSearch]);

  const run = async () => {
    if (!pid) { setError('请选择招标项目'); return; }
    if (extractMode === 'specialty_match' && !quotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false);
    toast.loading('AI 正在分析项目需求并抽取专家组...', { id: 'extract-loading' });
    setCompareResult2(null);
    try {
      if (compareMode) {
        const [result1, result2] = await Promise.all([
          previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode, manualQuotas: qp }),
          previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode: compareMode2, manualQuotas: qp }),
        ]);
        if (!result1?.selected) throw new Error('方案 A 返回数据异常');
        if (!result2?.selected) throw new Error('方案 B 返回数据异常');
        setPreview(result1);
        setCompareResult2(result2);
        setSelectedExperts([...result1.selected]);
        setAlternativeExperts([...result1.alternatives]);
      } else {
        const result = await previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode, manualQuotas: qp });
        if (!result?.selected) throw new Error('服务器返回数据异常');
        setPreview(result);
        setSelectedExperts([...result.selected]);
        setAlternativeExperts([...result.alternatives]);
      }
      setNotifyMessage(`您已被选为「${sel?.name || '招标项目'}」评审专家，请登录专家门户查看详情并完成评审任务。`);
      toast.dismiss('extract-loading');
    } catch (e: any) {
      toast.dismiss('extract-loading');
      setError(e?.message || '抽取失败');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!pid || selectedExperts.length === 0) return;
    setConfirming(true);
    try {
      const exps = selectedExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      const result = await confirmExtraction({ projectId: pid, experts: exps });
      setConfirmedExpertIds(result.expertIds || exps.map(e => e.userId));
      setShowNotifyModal(true);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  const sendNotify = async () => {
    if (notifyChannels.length === 0 || confirmedExpertIds.length === 0) return;
    setNotifying(true);
    try {
      const result = await sendExtractionNotify({ projectId: pid, expertIds: confirmedExpertIds, channels: notifyChannels, message: notifyMessage });
      setNotifyResults(result.results);
      setDone(true);
      toast.success(`通知已发送（${confirmedExpertIds.length} 名专家）`);
    } catch (e: any) { toast.error(e?.message || '通知发送失败'); }
    setNotifying(false);
  };

  const toggleChannel = (ch: string) => setNotifyChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);

  // 抽取历史
  const openHistory = async (page = 1) => {
    setShowHistory(true); setHistoryLoading(true); setHistoryPage(page);
    try {
      const data = await getExtractionHistory({ projectId: pid || undefined, page, pageSize: 15 });
      setHistoryData(data);
    } catch { setHistoryData(null); }
    setHistoryLoading(false);
  };

  // 手动调整
  const removeExpert = (index: number, role: 'selected' | 'alternative') => {
    if (role === 'selected') setSelectedExperts(prev => prev.filter((_, i) => i !== index));
    else setAlternativeExperts(prev => prev.filter((_, i) => i !== index));
  };
  const openReplace = (index: number, role: 'selected' | 'alternative') => {
    setReplaceTarget({ index, role });
    setReplaceSearch('');
    setShowReplaceModal(true);
  };
  const doReplace = (candidate: CandidatePoolItem) => {
    if (!replaceTarget) return;
    const newExpert: ExtractionSelected = {
      userId: candidate.userId, name: candidate.name, specialty: candidate.specialty,
      title: candidate.title || null, employer: candidate.employer || null,
      matchScore: candidate.matchScore, reason: candidate.reason, role: replaceTarget.role === 'selected' ? '正选' : '候补',
    };
    if (replaceTarget.role === 'selected') {
      setSelectedExperts(prev => prev.map((e, i) => i === replaceTarget.index ? newExpert : e));
    } else {
      setAlternativeExperts(prev => prev.map((e, i) => i === replaceTarget.index ? newExpert : e));
    }
    setShowReplaceModal(false);
    setReplaceTarget(null);
  };
  const addExpert = (candidate: CandidatePoolItem) => {
    const newExpert: ExtractionSelected = {
      userId: candidate.userId, name: candidate.name, specialty: candidate.specialty,
      title: candidate.title || null, employer: candidate.employer || null,
      matchScore: candidate.matchScore, reason: candidate.reason, role: '正选',
    };
    setSelectedExperts(prev => [...prev, newExpert]);
    setShowReplaceModal(false);
    setReplaceTarget(null);
  };
  const reset = () => { setDone(false); setPreview(null); setSelectedExperts([]); setAlternativeExperts([]); setShowNotifyModal(false); setNotifyResults(null); setConfirmedExpertIds([]); };

  // ── 配置卡片 ──
  const configCard = (
    <div className="neu-table-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Sparkles size={14} className="text-[var(--accent)]" /></div>
        <div><span className="text-sm font-bold text-[var(--foreground)]">抽取配置</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">{MODE_LABELS[extractMode]} · {et}人</span></div>
      </div>
      <div>
        <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">招标项目 *</label>
        <select value={pid} onChange={e => setPid(e.target.value)} className="neu-input text-sm w-full"><option value="">请选择需要组建评审组的项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}</select>
      </div>
      {sel && pd && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">采购方式：{sel.procurementMethod}</span>
          <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">阶段：{STAGE_LABEL[sel.stage] || sel.stage}</span>
          {pd.suppliers?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">参与供应商（将自动回避）：{pd.suppliers.map(s => s.supplierName).join('、')}</span>}
          {pd.experts?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-3 py-2 text-xs text-[var(--success)]">已分配专家：{pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</span>}
        </div>
      )}
      <hr className="wb-section-rule" />

      {/* 三种抽取模式 */}
      <div className="grid grid-cols-3 gap-2">
        {(Object.entries(MODE_LABELS) as [ExtractMode, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setExtractMode(key)}
            className={`neu-tab flex-col gap-0.5 py-2.5 ${extractMode === key ? 'is-active' : ''}`}
          >
            <span className="text-xs font-bold">{label}</span>
            <span className="text-[10px] text-[var(--muted-foreground)] leading-tight">{MODE_DESCS[key]}</span>
          </button>
        ))}
      </div>

      {/* 模式特定配置 */}
      {extractMode === 'specialty_match' && (
        <div>
          <div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专业配额（正选合计 {qt} 人）</span><button onClick={addQ} className="neu-btn-xs"><Plus size={12} />添加专业</button></div>
          {quotas.map((q, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <select value={q.specialty} onChange={e => upQ(i, 'specialty', e.target.value)} className="neu-input text-sm flex-1"><option value="">选择专业</option>{specs.map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人可用）` : ''}</option>)}</select>
              <div className="flex items-center gap-1"><button onClick={() => upQ(i, 'count', Math.max(1, q.count - 1))} className="neu-btn-xs">−</button><span className="w-6 text-center text-sm font-extrabold tabular-nums text-[var(--foreground)]">{q.count}</span><button onClick={() => upQ(i, 'count', q.count + 1)} className="neu-btn-xs">+</button></div>
              <button onClick={() => rmQ(i)} disabled={quotas.length <= 1} className="neu-btn-xs is-danger">×</button>
            </div>
          ))}
        </div>
      )}

      {/* 人数配置 + 操作按钮 */}
      <div className="flex items-end gap-3">
        <div className="flex gap-3 flex-1">
          <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)] flex-1">候补人数<select value={alt} onChange={e => setAlt(Number(e.target.value))} className="neu-input text-sm w-full">{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
          {extractMode !== 'specialty_match' && (
            <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)] flex-1">正选人数<select value={tn} onChange={e => setTn(Number(e.target.value))} className="neu-input text-sm w-full">{[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)] cursor-pointer select-none whitespace-nowrap">
            <span>对比</span>
            <button
              onClick={(e) => { e.preventDefault(); setCompareMode(v => !v); }}
              className={`w-7 h-4 rounded-full transition-colors relative flex-shrink-0 ${compareMode ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]/40'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${compareMode ? 'left-[13px]' : 'left-0.5'}`} />
            </button>
          </label>
          <button onClick={run} disabled={loading || !pid} className="neu-btn-soft !w-auto justify-center px-6">
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {loading ? '抽取中...' : '开始抽取'}
          </button>
        </div>
      </div>
      {compareMode && (
        <div className="flex items-center gap-2 rounded-lg bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-3 py-1.5">
          <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">对比方案 B：</span>
          <select value={compareMode2} onChange={e => setCompareMode2(e.target.value as ExtractMode)} className="workbench-input !h-[28px] !text-[11px] !w-auto !min-w-[80px]">
            {extractMode !== 'specialty_match' && <option value="specialty_match">专业匹配</option>}
            {extractMode !== 'random' && <option value="random">随机抽取</option>}
            {extractMode !== 'merit_best' && <option value="merit_best">综合择优</option>}
          </select>
        </div>
      )}
    </div>
  );

  // ── 专家库概览 ──
  const poolCard = pool.size > 0 ? (
    <div className="neu-table-card p-4 text-sm">
      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">专家库各专业可用人数</span>
      <div className="mt-3 space-y-1.5">
        {[...pool.entries()].sort((a, b) => b[1] - a[1]).map(([specialty, count]) => (
          <div key={specialty} className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--foreground)]">{specialty}</span>
            <span className={`font-bold tabular-nums ${count < 3 ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>{count} 人{count < 3 && <span className="ml-1 text-[10px] text-[var(--danger)]">⚠</span>}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  // ── 替换/添加弹窗 ──
  // 被替换的原专家信息
  const replacedExpert = useMemo(() => {
    if (!replaceTarget) return null;
    const list = replaceTarget.role === 'selected' ? selectedExperts : alternativeExperts;
    return list[replaceTarget.index] || null;
  }, [replaceTarget, selectedExperts, alternativeExperts]);

  const replaceModal = showReplaceModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => { setShowReplaceModal(false); setReplaceTarget(null); }}>
      <div className="neu-table-card w-full max-w-2xl max-h-[75vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-[var(--foreground)]">{replaceTarget ? '替换专家' : '添加专家'}</span>
          <button onClick={() => { setShowReplaceModal(false); setReplaceTarget(null); }} className="neu-btn-xs is-danger"><X size={14} /></button>
        </div>
        {/* 原专家对比 */}
        {replacedExpert && (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--surface)_80%,transparent)] p-3 mb-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
            <div className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)] mb-2">当前专家</div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-bold text-[var(--foreground)]">{replacedExpert.name}</span>
              <span className="text-[var(--muted-foreground)]">{replacedExpert.specialty}</span>
              {replacedExpert.title && <span className="text-[var(--muted-foreground)]">· {replacedExpert.title}</span>}
              <span className="font-bold ml-auto" style={{ color: scoreVar(replacedExpert.matchScore) }}>匹配度 {replacedExpert.matchScore}</span>
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1">{replacedExpert.reason}</p>
          </div>
        )}
        <input value={replaceSearch} onChange={e => setReplaceSearch(e.target.value)} placeholder="搜索候选专家姓名/专业..." className="neu-input text-sm w-full mb-3" autoFocus />
        <div className="flex-1 overflow-y-auto space-y-1 max-h-[400px]">
          {filteredPool.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)] text-center py-8">暂无可用候选专家</p>
          ) : (
            filteredPool.map(c => {
              const vsReplaced = replacedExpert ? c.matchScore - (replacedExpert.matchScore || 0) : 0;
              return (
                <div key={c.userId} className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--foreground)] truncate">{c.name}</span>
                      {c.evaluationLevel && <StatusBadge tone={c.evaluationLevel === 'A' ? 'green' : c.evaluationLevel === 'B' ? 'blue' : c.evaluationLevel === 'D' ? 'red' : 'gray'}>{c.evaluationLevel}</StatusBadge>}
                      {c.currentLoadStatus && <span className="text-[10px] text-[var(--muted-foreground)]">{c.currentLoadStatus}</span>}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] truncate">{c.specialty}{c.title ? ` · ${c.title}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className="text-xs font-bold tabular-nums" style={{ color: scoreVar(c.matchScore) }}>{c.matchScore}</span>
                    {replacedExpert && (
                      <span className={`text-[10px] font-bold tabular-nums ${vsReplaced >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                        {vsReplaced >= 0 ? '+' : ''}{vsReplaced}
                      </span>
                    )}
                    <button onClick={() => replaceTarget ? doReplace(c) : addExpert(c)} className="neu-btn-xs">选择</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  // ── 通知弹窗 ──
  const notifyModal = showNotifyModal && !notifyResults && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setShowNotifyModal(false)}>
      <div className="neu-table-card w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <div className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Bell size={14} className="text-[var(--accent)]" /></div>
          <span className="text-sm font-bold text-[var(--foreground)]">通知专家组成员</span>
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">{confirmedExpertIds.length} 名专家</span>
        </div>

        {/* 通知渠道选择 */}
        <div className="mb-4">
          <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-2">通知渠道</span>
          <div className="flex gap-2">
            {[
              { key: 'in_app', icon: Bell, label: 'OA站内信' },
              { key: 'sms', icon: MessageSquare, label: '短信通知' },
              { key: 'phone', icon: Phone, label: '电话通知' },
            ].map(ch => (
              <button
                key={ch.key}
                onClick={() => toggleChannel(ch.key)}
                className={`neu-tab flex-col gap-1 py-2 flex-1 ${notifyChannels.includes(ch.key) ? 'is-active' : ''}`}
              >
                <ch.icon size={16} />
                <span className="text-[11px]">{ch.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 消息模板 */}
        <div className="mb-4">
          <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-2">通知内容</span>
          <textarea
            value={notifyMessage}
            onChange={e => setNotifyMessage(e.target.value)}
            className="neu-input text-sm w-full min-h-[80px] resize-y"
            rows={3}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={() => { setShowNotifyModal(false); setDone(true); toast.success(`专家组已组建（${selectedExperts.length} 人）`); }} className="neu-btn-soft flex-1 justify-center">跳过通知</button>
          <button onClick={sendNotify} disabled={notifying || notifyChannels.length === 0} className="neu-btn-soft is-success flex-1 justify-center">{notifying ? '发送中...' : `发送通知（${notifyChannels.length} 渠道）`}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {!hideHeader && (
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家智能抽取</div><div className="page-hero__sub">专业匹配 / 随机抽取 / 综合择优，AI 分析项目需求并智能组建专家组</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => openHistory()} className="neu-btn-soft gap-1.5 !bg-white">
              <Clock size={15} />抽取历史
            </button>
            <RulesPopover>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">专家抽取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">1.</span>合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目，自动回避利益相关方</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">2.</span>三种抽取模式：专业匹配（AI分析专业构成+加权随机）、随机抽取（合规池公平随机）、综合择优（多维履职数据排名择优）</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">3.</span>多维评估：AI 综合专家履职评价等级(A/B/C/D)、出勤/质量/廉洁三维度评分、评分偏离度、历史经验与当前负荷</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">4.</span>手动调整：抽取后可替换/移除/添加专家，灵活组建最终专家组</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">5.</span>通知送达：确认后支持 OA站内信 / 短信 / 电话 多渠道通知被选专家</li>
              </ol>
            </RulesPopover>
          </div>
        </div>
      </div>
      )}

      {hasResults ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <div className="lg:col-span-2 space-y-4">
            {configCard}
            {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}
            {loading && <div className="neu-table-card py-14 text-center"><div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]"><RefreshCw size={14} className="animate-spin" />AI 正在分析项目需求并抽取专家组...</div></div>}

            {/* 抽取结果 + 手动调整 */}
            {preview && !loading && !done && (
              <div className="space-y-4">
                {/* AI 分析 */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center gap-2 mb-3"><Sparkles size={16} className="text-[var(--accent)]" /><h2 className="text-sm font-bold text-[var(--foreground)]">AI 评审组分析</h2><StatusBadge tone={preview.engine === 'deepseek' ? 'purple' : 'gray'} className="ml-auto">{preview.engine === 'deepseek' ? 'AI · DeepSeek' : '规则引擎'}</StatusBadge></div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{preview.analysis}</p>
                  {preview.requiredSpecialties.length > 0 && <div className="flex flex-wrap items-center gap-2 mt-3">{preview.requiredSpecialties.map(q => <span key={q.specialty} className="neu-tab-count">{q.specialty} × {q.count}</span>)}</div>}
                </div>

                {preview.shortages.length > 0 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"><AlertTriangle size={16} className="inline mr-2" />专业候选人不足{preview.shortages.map(s => `：${s.specialty} 需${s.needed}人/仅${s.available}人`).join('')}</div>}

                {/* 对比模式结果面板 */}
                {compareMode && compareResult2 && (
                  <div className="neu-table-card p-4 space-y-3">
                    <div className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">方案对比 · {MODE_LABELS[extractMode]}（A） vs {MODE_LABELS[compareMode2]}（B）</div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* 列 A */}
                      <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <StatusBadge tone="blue">方案 A</StatusBadge>
                          <span className="text-xs font-bold text-[var(--foreground)]">{MODE_LABELS[extractMode]}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">正选人数</span><span className="font-bold tabular-nums">{preview.selected.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">候补人数</span><span className="font-bold tabular-nums">{preview.alternatives.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">平均匹配度</span><span className="font-bold tabular-nums">{preview.selected.length > 0 ? Math.round(preview.selected.reduce((s, e) => s + e.matchScore, 0) / preview.selected.length) : 0}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">引擎</span><span className="font-bold">{preview.engine === 'deepseek' ? 'AI' : '规则'}</span></div>
                        </div>
                        <button onClick={() => { setCompareMode(false); setCompareResult2(null); }} className="neu-btn-xs w-full justify-center mt-3">采用方案 A</button>
                      </div>
                      {/* 列 B */}
                      <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_6%,transparent)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <StatusBadge tone="orange">方案 B</StatusBadge>
                          <span className="text-xs font-bold text-[var(--foreground)]">{MODE_LABELS[compareMode2]}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">正选人数</span><span className="font-bold tabular-nums">{compareResult2.selected.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">候补人数</span><span className="font-bold tabular-nums">{compareResult2.alternatives.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">平均匹配度</span><span className="font-bold tabular-nums">{compareResult2.selected.length > 0 ? Math.round(compareResult2.selected.reduce((s: number, e: any) => s + e.matchScore, 0) / compareResult2.selected.length) : 0}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">引擎</span><span className="font-bold">{compareResult2.engine === 'deepseek' ? 'AI' : '规则'}</span></div>
                        </div>
                        <button onClick={() => { setPreview(compareResult2); setSelectedExperts([...compareResult2.selected]); setAlternativeExperts([...compareResult2.alternatives]); setExtractMode(compareMode2); setCompareMode(false); setCompareResult2(null); }} className="neu-btn-xs is-warning w-full justify-center mt-3">采用方案 B</button>
                      </div>
                    </div>
                    {/* 名单交集分析 */}
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {(() => {
                        const idsA = new Set(preview.selected.map((e: any) => e.userId));
                        const idsB = new Set(compareResult2.selected.map((e: any) => e.userId));
                        const overlap = [...idsA].filter(id => idsB.has(id)).length;
                        return <>两方案共有 <strong className="text-[var(--foreground)]">{overlap}</strong> 名专家重叠，差异 <strong className="text-[var(--foreground)]">{idsA.size + idsB.size - overlap * 2}</strong> 名</>;
                      })()}
                    </div>
                  </div>
                )}

                {/* 正选专家组（可调整） */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">正选专家组 · {selectedExperts.length} 人</span>
                    <button onClick={() => { setReplaceTarget(null); setReplaceSearch(''); setShowReplaceModal(true); }} className="neu-btn-xs"><Plus size={12} />添加专家</button>
                  </div>
                  {selectedExperts.map((s, i) => (
                    <div key={s.userId} className="flex items-start gap-3 mt-3" style={i > 0 ? { borderTop: "1px solid oklch(0.55 0.03 258 / 0.06)", paddingTop: "0.75rem" } : {}}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span><StatusBadge tone="blue">{s.specialty}</StatusBadge><StatusBadge tone="green">正选</StatusBadge></div>
                        <div className="flex items-center gap-2 my-1.5"><div className="flex-1 h-2 rounded-full bg-[var(--muted)]/50 overflow-hidden max-w-[140px]"><div className="h-full rounded-full" style={{ width: `${s.matchScore}%`, backgroundColor: scoreVar(s.matchScore) }} /></div><strong className="text-xs tabular-nums" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</strong></div>
                        <p className="text-xs text-[var(--muted-foreground)] mb-1">{s.reason}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openReplace(i, 'selected')} className="neu-btn-xs" title="替换"><Pencil size={11} /></button>
                        <button onClick={() => removeExpert(i, 'selected')} className="neu-btn-xs is-danger" title="移除"><X size={11} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 候补专家 */}
                {alternativeExperts.length > 0 && (
                  <div className="neu-table-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">候补专家 · {alternativeExperts.length} 人</span>
                    </div>
                    {alternativeExperts.map((s, i) => (
                      <div key={s.userId} className="flex items-center justify-between mt-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-[var(--foreground)] truncate">{s.name}</span>
                          <span className="text-[var(--muted-foreground)]">{s.specialty}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-nums" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</span>
                          <button onClick={() => openReplace(i, 'alternative')} className="neu-btn-xs" title="替换"><Pencil size={10} /></button>
                          <button onClick={() => removeExpert(i, 'alternative')} className="neu-btn-xs is-danger" title="移除"><X size={10} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={confirm} disabled={confirming || selectedExperts.length === 0} className="neu-btn-soft is-success w-full justify-center"><Check size={16} />{confirming ? '确认中...' : `确认组建专家组（${selectedExperts.length} 人）`}</button>
              </div>
            )}

            {/* 完成状态 */}
            {done && (
              <div className="neu-table-card p-10 text-center">
                <ShieldCheck size={40} className="mx-auto text-[var(--success)] mb-3" />
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">专家组已组建</h3>
                <p className="text-sm text-[var(--muted-foreground)]">已为「{sel?.name}」分配专家</p>
                {notifyResults && (
                  <div className="mt-4 text-left max-w-sm mx-auto space-y-1">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">通知投递状态</span>
                    {notifyResults.map((r: any) => (
                      <div key={r.userId} className="text-xs text-[var(--muted-foreground)] flex items-center gap-2">
                        <span className="font-medium text-[var(--foreground)]">{selectedExperts.find(e => e.userId === r.userId)?.name || r.userId}</span>
                        {Object.entries(r.results).map(([ch, status]) => (
                          <span key={ch} className={`${status === 'sent' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>{ch}:{status as string}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-center gap-3 mt-6"><button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">返回专家库</button><button onClick={reset} className="neu-btn-soft">重新抽取</button></div>
              </div>
            )}
          </div>
          <div className="lg:col-span-1 space-y-4">{poolCard}</div>
        </div>
      ) : (
        <div className="space-y-5">
          {configCard}
          {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}
        </div>
      )}

      {replaceModal}
      {notifyModal}

      {/* 抽取历史弹窗 */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowHistory(false)}>
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-[min(720px,94vw)] max-h-[85vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
            role="dialog"
            onClick={e => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-start justify-between gap-4 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258/0.12),inset_-2px_-2px_5px_oklch(1_0_0/0.55)]">
                  <Clock size={15} className="text-[var(--accent)]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[var(--foreground)]">抽取历史</h2>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {pid ? `「${sel?.name || pid}」的历次专家组组建记录` : '全部项目的专家组组建记录'}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowHistory(false)} className="neu-btn-xs"><X size={16} /></button>
            </div>

            <hr className="wb-section-rule" />

            {/* 内容区 */}
            <div className="pt-4">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-sm font-bold text-[var(--accent)]">
                  <RefreshCw size={14} className="animate-spin" />加载中...
                </div>
              ) : !historyData || historyData.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-14">
                  <FileText size={36} className="text-[var(--muted-foreground)]/40" />
                  <p className="text-sm text-[var(--muted-foreground)]">暂无抽取记录</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]/60">确认专家抽取后将自动记录于此</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {historyData.items.map((item: any) => {
                      const d = item.details || {};
                      const time = new Date(item.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div
                          key={item.id}
                          className="rounded-[14px] bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-4 py-3
                            shadow-[inset_0_1px_0_oklch(1_0_0/0.65),1.5px_1.5px_3px_oklch(0.55_0.03_258/0.08),-1px_-1px_2.5px_oklch(1_0_0/0.8)]
                            hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.75),2.5px_2.5px_5px_oklch(0.55_0.03_258/0.12),-1.5px_-1.5px_4px_oklch(1_0_0/0.88)]
                            transition-all duration-300 ease-out"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              {/* 第一行：项目名 + 时间 */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-bold text-[var(--foreground)] truncate">
                                  {d.projectName || '招标项目'}
                                </span>
                                <span className="text-[10px] tabular-nums text-[var(--muted-foreground)] shrink-0">
                                  {time}
                                </span>
                              </div>
                              {/* 第二行：操作人 + 专家数 */}
                              <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
                                <span className="inline-flex items-center gap-1">
                                  <UserCircle size={12} className="text-[var(--muted-foreground)]/60" />
                                  {item.user?.displayName || '系统'}
                                </span>
                                <span>组建专家组 {d.expertCount ?? (Array.isArray(d.experts) ? d.experts.length : 0)} 人</span>
                              </div>
                              {/* 第三行：专家名单 */}
                              {Array.isArray(d.experts) && d.experts.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {d.experts.map((ex: any, ei: number) => (
                                    <span
                                      key={ei}
                                      className="inline-flex items-center rounded-[7px] px-2 py-0.5 text-[10px] font-medium
                                        shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5),0.5px_0.5px_1.5px_oklch(0.55_0.03_258/0.06)]
                                        text-[var(--foreground)] bg-[color-mix(in_oklch,var(--surface)_50%,transparent)]"
                                    >
                                      {ex.name}
                                      <span className="ml-1 text-[var(--muted-foreground)]/70">{ex.major}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 分页 */}
                  {historyData.total > historyData.pageSize && (
                    <>
                      <hr className="wb-section-rule mt-4" />
                      <div className="flex items-center justify-between pt-3 text-xs">
                        <span className="text-[var(--muted-foreground)] tabular-nums">
                          共 {historyData.total} 条 · 第 {historyData.page}/{Math.ceil(historyData.total / historyData.pageSize)} 页
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openHistory(historyPage - 1)}
                            disabled={historyPage <= 1}
                            className="neu-btn-xs"
                          >
                            ←
                          </button>
                          <button
                            onClick={() => openHistory(historyPage + 1)}
                            disabled={historyPage >= Math.ceil(historyData.total / historyData.pageSize)}
                            className="neu-btn-xs"
                          >
                            →
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">加载抽取配置...</div>}><ExpertExtractPage /></Suspense>;
}
