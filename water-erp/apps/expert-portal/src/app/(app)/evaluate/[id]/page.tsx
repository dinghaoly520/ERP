'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { ExpertProjectDetail, DecryptedDocuments, AssistData, EvaluationReport } from '@/lib/types';
import { ShieldCheck, FileText, Sparkles, Edit3, BarChart3, Lock, Unlock, ArrowLeft, Download, AlertTriangle, CheckCircle, Lightbulb, Key, Wrench, Clipboard, Gavel, Building2, Megaphone, Star, Search, UserCircle, TrendingUp, Clock, ScrollText, Pencil, ShoppingCart, Inbox, Construction, MessageSquare } from 'lucide-react';

type Step = 'verify' | 'documents' | 'assist' | 'scoring' | 'report';
const STEPS: { key: Step; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { key: 'verify', label: '身份核验', Icon: ShieldCheck },
  { key: 'documents', label: '标书获取', Icon: FileText },
  { key: 'assist', label: '辅助评标', Icon: Sparkles },
  { key: 'scoring', label: '专家打分', Icon: Edit3 },
  { key: 'report', label: '评审报告', Icon: BarChart3 },
];

const CATEGORY_LABEL: Record<string, string> = {
  QUALIFICATION: '资格审查', RESPONSIVE: '响应性评审', BUSINESS: '商务评审', TECHNICAL: '技术评审', PRICE: '价格评审',
};
const CATEGORY_COLOR: Record<string, string> = {
  QUALIFICATION: '#064ea2', RESPONSIVE: '#0b63ce', BUSINESS: '#f5a623', TECHNICAL: '#11a874', PRICE: '#e74c3c',
};

export default function ExpertEvaluatePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ExpertProjectDetail | null>(null);
  const [step, setStep] = useState<Step>('verify');
  const [activeSupplier, setActiveSupplier] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [documents, setDocuments] = useState<DecryptedDocuments | null>(null);
  const [assistData, setAssistData] = useState<AssistData | null>(null);
  // P0-1: scores keyed by `${supplierId}:${scoreItemId}` (composite) — never flat by scoreItemId.
  const [scores, setScores] = useState<Record<string, { score: number; reason: string }>>({});
  const [report, setReport] = useState<EvaluationReport | null>(null);

  const [confidentialityAgreed, setConfidentialityAgreed] = useState(false);
  const [disciplineAgreed, setDisciplineAgreed] = useState(false);

  // P0-2: reason validation — set of scoreItemIds whose reason is missing on submit attempt.
  const [missingReasons, setMissingReasons] = useState<Set<string>>(new Set());
  // P0-3: draft autosave to localStorage.
  const [draftAvailable, setDraftAvailable] = useState<{ count: number; savedAt: number } | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composite key helper — keeps the per-supplier invariant explicit at every call site.
  const scoreKey = (supplierId: string, scoreItemId: string) => `${supplierId}:${scoreItemId}`;

  const loadProject = useCallback(() => {
    setLoading(true);
    api.get<ExpertProjectDetail>(`/expert/projects/${projectId}`)
      .then(p => {
        setProject(p);
        if (p.suppliers.length > 0 && !p.suppliers.some(su => su.id === activeSupplier)) {
          setActiveSupplier(p.suppliers[0].id);
        } else if (p.suppliers.length > 0 && !activeSupplier) {
          setActiveSupplier(p.suppliers[0].id);
        }
        // P0-1: hydrate with composite keys so each supplier's scores are isolated.
        const existing: Record<string, { score: number; reason: string }> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = { score: Number(rec.score), reason: rec.reason || '' };
        });
        setScores(existing);
      })
      .catch((e: any) => toast.error(e?.message || '加载项目失败'))
      .finally(() => setLoading(false));
  }, [projectId, activeSupplier]);

  // P0-3: on first project load, check for an unrecovered draft.
  const expertId = project?.myExpertRecord?.id;
  const draftStorageKey = expertId ? `expert-draft:${projectId}:${expertId}` : '';
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string }>; savedAt: number };
      const count = Object.keys(draft.scores || {}).length;
      if (count > 0) setDraftAvailable({ count, savedAt: draft.savedAt });
    } catch { /* corrupt draft — ignore */ }
  }, [draftStorageKey]);

  // P0-3: debounced autosave whenever scores change (only while scoring).
  useEffect(() => {
    if (!draftStorageKey || step !== 'scoring') return;
    const entries = Object.keys(scores).length;
    if (entries === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() }));
      } catch { /* quota / private mode — ignore */ }
    }, 2000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [scores, draftStorageKey, step]);

  const restoreDraft = () => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string }> };
      setScores(prev => ({ ...prev, ...draft.scores }));
      toast.success(`已恢复 ${Object.keys(draft.scores).length} 项评分草稿`);
    } catch { toast.error('草稿已损坏，无法恢复'); }
    setDraftAvailable(null);
    setDraftDismissed(true);
  };
  const discardDraft = () => {
    if (draftStorageKey) localStorage.removeItem(draftStorageKey);
    setDraftAvailable(null);
    setDraftDismissed(true);
  };
  const saveDraftNow = () => {
    if (!draftStorageKey) return;
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() }));
      toast.success('草稿已保存');
    } catch { toast.error('草稿保存失败'); }
  };

  useEffect(() => { loadProject(); }, [loadProject]);

  const expert = project?.myExpertRecord;

  const handleSignIn = async () => {
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/sign-in`, {}); loadProject(); }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    setBusy(false);
  };

  const handleAvoidance = async () => {
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/avoidance`, {}); loadProject(); }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    setBusy(false);
  };

  const loadDocuments = async (sid: string) => {
    try { setDocuments(await api.get<DecryptedDocuments>(`/expert/projects/${projectId}/documents/${sid}`)); }
    catch (e: any) { toast.error(e.message || '加载标书失败'); }
  };

  const loadAssist = async (sid: string) => {
    try { setAssistData(await api.get<AssistData>(`/expert/projects/${projectId}/assist/${sid}`)); }
    catch (e: any) { toast.error(e.message || '加载AI数据失败'); }
  };

  useEffect(() => {
    if (step === 'documents' && activeSupplier) loadDocuments(activeSupplier);
    if (step === 'assist' && activeSupplier) loadAssist(activeSupplier);
  }, [step, activeSupplier]);

  const handleSubmitScores = async () => {
    if (!project || !activeSupplier) return;
    if (expert?.reportConfirmed) { toast.warning('评审报告已确认，评分已锁定'); return; }
    const activeSupplierRecord = project.suppliers.find(s => s.id === activeSupplier);
    const supplierName = activeSupplierRecord?.supplierName || '';
    const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回';
    if (!canScoreActiveSupplier) {
      toast.warning('该投标单位未解密成功或已撤回，不能评分');
      return;
    }
    // P0-2: any item scored below full marks MUST carry a non-empty reason (满分项豁免).
    const missing: string[] = [];
    for (const si of project.scoreItems) {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      const score = entry?.score ?? 0;
      const reason = (entry?.reason ?? '').trim();
      if (score < Number(si.maxScore) && !reason) missing.push(si.id);
    }
    if (missing.length > 0) {
      setMissingReasons(new Set(missing));
      toast.warning(`${missing.length} 个评分项得分低于满分但未填写评分理由，已高亮标记，请补充后再提交`);
      const firstEl = document.querySelector(`[data-score-item="${missing[0]}"]`);
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setMissingReasons(new Set()); // clear on valid submit
    const scoresPayload = project.scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      return { scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '' };
    });
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/scores`, { scores: scoresPayload, supplierName });
      // P0-3: clear draft on successful submit.
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      setDraftAvailable(null);
      loadProject();
      toast.success(`${supplierName} 评分提交成功`);
    } catch (e: any) { toast.error(e.message || '提交失败'); }
    setBusy(false);
  };

  const loadReport = async () => {
    try { setReport(await api.get<EvaluationReport>(`/expert/projects/${projectId}/report`)); }
    catch (e: any) { toast.error(e.message || '加载报告失败'); }
  };

  useEffect(() => { if (step === 'report') loadReport(); }, [step]);

  const handleConfirmReport = async () => {
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/report/confirm`, { comment: '确认完成评审' }); loadProject(); toast.success('评审报告已确认'); }
    catch (e: any) { toast.error(e.message || '确认失败'); }
    setBusy(false);
  };

  if (loading || !project) return <div className="flex items-center justify-center h-64 text-[oklch(0.55_0.01_264)]">加载中...</div>;

  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '已解密', DANGER: '异常' };
  const activeSupplierRecord = project.suppliers.find(s => s.id === activeSupplier);
  const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回';
  const scoreLocked = !!expert?.reportConfirmed;

  const formatBytes = (n: number) => {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/projects')} className="text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] transition">← 返回</button>
          <div className="w-px h-6 bg-[#e8f0fa]" />
          <h1 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">{project.name}</h1>
          <span className="text-sm text-[oklch(0.55_0.01_264)]">{project.projectCode}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[oklch(0.55_0.01_264)]">评审进度</span>
          <div className="w-40 h-2 bg-[oklch(0.94_0.004_264)] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#064ea2] to-[#0b63ce] rounded-full transition-all duration-500"
              style={{ width: `${expert?.progress ?? 0}%` }} />
          </div>
          <span className="text-sm font-bold text-[#064ea2]">{expert?.progress ?? 0}%</span>
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-4 mb-4 flex-shrink-0">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <button onClick={() => setStep(s.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-semibold ${step === s.key ? 'bg-[#064ea2] text-white shadow-md' : 'text-[oklch(0.55_0.01_264)] hover:bg-blue-50'}`}>
                <s.Icon size={16} strokeWidth={1.5} />{s.label}
              </button>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-[#e8f0fa] mx-2" />}
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        {/* 左侧供应商列表 */}
        <div className="w-56 flex-shrink-0 bg-white rounded-xl border border-[oklch(0.91_0.006_264)] overflow-y-auto">
          <div className="p-4 border-b border-[oklch(0.91_0.006_264)]">
            <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]">投标单位</h3>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mt-1">{project.suppliers.length} 家</p>
          </div>
          <div className="p-2">
            {project.suppliers.map(s => (
              <button key={s.id} onClick={() => { setActiveSupplier(s.id); setMissingReasons(new Set()); }}
                className={`w-full text-left p-3 rounded-lg mb-1 text-sm transition-all ${activeSupplier === s.id ? 'bg-blue-50 border border-[#bfdbfe]' : 'hover:bg-[oklch(0.992_0.003_264)] border border-transparent'}`}>
                <div className="font-semibold text-[oklch(0.18_0.012_265)] truncate">{s.supplierName}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.decryptStatus === 'SUCCESS' ? 'bg-[#11a874]' : s.decryptStatus === 'DANGER' ? 'bg-[#e74c3c]' : 'bg-[#f5a623]'}`} />
                  <span className="text-xs text-[oklch(0.55_0.01_264)]">{decryptLabel[s.decryptStatus] || s.decryptStatus}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右侧主内容 */}
        <div className="flex-1 bg-white rounded-xl border border-[oklch(0.91_0.006_264)] overflow-y-auto">
          {/* ====== 身份核验 ====== */}
          {step === 'verify' && (
            <div className="p-6 max-w-3xl mx-auto">
              <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)] mb-6">身份核验与承诺确认</h2>
              <div className="space-y-4 mb-6">
                {[
                  { label: '身份核验', desc: '确认您的专家身份信息', done: !!expert?.signedIn, action: !expert?.signedIn ? handleSignIn : undefined },
                  { label: '保密承诺', desc: '承诺不泄露评标过程中获取的信息', done: confidentialityAgreed, action: undefined },
                  { label: '回避确认', desc: '确认与投标单位无利益关系', done: !!expert?.avoidanceConfirmed, action: expert?.signedIn && !expert?.avoidanceConfirmed ? handleAvoidance : undefined },
                  { label: '评标纪律', desc: '遵守独立评审原则', done: disciplineAgreed, action: undefined },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${item.done ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[oklch(0.91_0.006_264)]'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${item.done ? 'bg-emerald-500 text-white' : 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'}`}>
                      {item.done ? '✓' : i + 1}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${item.done ? 'text-emerald-600' : 'text-[oklch(0.18_0.012_265)]'}`}>{item.label}</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">{item.desc}</p>
                    </div>
                    {item.action && (
                      <button onClick={item.action} disabled={busy}
                        className="px-4 py-2 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50">确认</button>
                    )}
                  </div>
                ))}
              </div>

              {/* 保密承诺书 */}
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-6 mb-4">
                <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><Clipboard size={14} strokeWidth={1.5} /> 保密承诺书</h3>
                <p className="text-sm text-[oklch(0.55_0.01_264)] leading-relaxed mb-4">
                  本人作为本项目评审专家，郑重承诺：在评标过程中严格遵守保密规定，不向任何第三方泄露评标过程中获取的投标文件内容、评审意见及其他相关信息。如有违反，愿意承担相应法律责任。
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={confidentialityAgreed} onChange={e => setConfidentialityAgreed(e.target.checked)}
                    className="w-4 h-4 rounded border-blue-200 text-[#064ea2] focus:ring-[#064ea2]" />
                  <span className="text-sm text-[oklch(0.18_0.012_265)] font-semibold">本人已阅读并同意以上保密承诺</span>
                </label>
              </div>

              {/* 评标纪律 */}
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-6">
                <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><Gavel size={14} strokeWidth={1.5} /> 评标纪律承诺</h3>
                <ul className="space-y-2 text-sm text-[oklch(0.55_0.01_264)] mb-4">
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>严格按照招标文件规定的评审标准和方法进行评审</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>独立评审，不与其他专家串通或私下交流评审意见</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>客观公正，不带任何偏见和个人倾向</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>对评审过程和结果保密，不向任何人透露</li>
                </ul>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={disciplineAgreed} onChange={e => setDisciplineAgreed(e.target.checked)}
                    className="w-4 h-4 rounded border-blue-200 text-[#064ea2] focus:ring-[#064ea2]" />
                  <span className="text-sm text-[oklch(0.18_0.012_265)] font-semibold">本人已阅读并同意遵守以上评标纪律</span>
                </label>
              </div>

              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && (
                <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-3">
                  <span className="text-2xl"><CheckCircle size={14} strokeWidth={1.5} /></span>
                  <div>
                    <h3 className="font-bold text-emerald-600">核验完成</h3>
                    <p className="text-sm text-[oklch(0.55_0.01_264)]">您已完成身份核验，可以开始评审工作</p>
                  </div>
                  <button onClick={() => setStep('documents')}
                    className="ml-auto px-5 py-2 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 transition text-sm">
                    进入标书获取 →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ====== 标书获取 ====== */}
          {step === 'documents' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">标书解密与获取</h2>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">查看已解密的投标文件</p>
                </div>
                <span className="text-xs bg-blue-50 text-[#064ea2] px-3 py-1.5 rounded-lg font-semibold">
                  当前：{project.suppliers.find(s => s.id === activeSupplier)?.supplierName || '请选择'}
                </span>
              </div>

              {documents ? (
                <>
                  <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${documents.canView ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <span className="text-xl">{documents.canView ? <Unlock size={20} strokeWidth={1.5} /> : <Lock size={20} strokeWidth={1.5} />}</span>
                    <div>
                      <h3 className={`font-bold ${documents.canView ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {documents.canView ? '标书已解密' : '标书尚未解密'}
                      </h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">{documents.canView ? '您可以查看该供应商的投标文件' : '请等待开标主持端完成解密'}</p>
                    </div>
                  </div>

                  {documents.canView && (
                    <div className="grid grid-cols-2 gap-4">
                      {documents.documents.length === 0 ? (
                        <div className="col-span-2 text-center py-10 text-[oklch(0.55_0.01_264)]">该供应商未提交可查看的投标文件</div>
                      ) : documents.documents.map((doc, i) => (
                        <div key={i} className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100 hover:shadow-md transition-all">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white text-[10px] font-bold uppercase">{doc.type.replace('application/', '').replace('image/', '')}</div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-[oklch(0.18_0.012_265)] truncate" title={doc.originalName}>{doc.originalName}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs text-[oklch(0.55_0.01_264)]">{formatBytes(doc.size)}</span>
                              <span className="text-xs text-emerald-600 font-semibold">{doc.status}</span>
                            </div>
                          </div>
                          {doc.downloadUrl ? (
                            <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-1.5 bg-[#064ea2] text-white text-xs rounded-lg hover:bg-[#054280] transition"><Download size={14} strokeWidth={1.5} /> 预览/下载</a>
                          ) : (
                            <span className="text-xs text-[oklch(0.62_0.008_264)] px-3 py-1.5">待解密</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">
                  <div className="text-4xl mb-3"><FileText size={14} strokeWidth={1.5} /></div>
                  <p>请先在左侧选择一个投标单位查看标书</p>
                </div>
              )}
            </div>
          )}

          {/* ====== 辅助评标（AI引擎驱动） ====== */}
          {step === 'assist' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]"><Sparkles size={14} strokeWidth={1.5} /> AI 辅助评标</h2>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">智能分析引擎基于规则+统计驱动，结果仅供参考，请以专业判断为准</p>
                </div>
                <span className="text-xs bg-blue-50 text-[#064ea2] px-3 py-1.5 rounded-lg font-semibold">
                  当前：{project.suppliers.find(s => s.id === activeSupplier)?.supplierName || '请选择'}
                </span>
              </div>

              {assistData ? (
                <div className="space-y-6">
                  {/* AI 综合评分卡 */}
                  <div className="bg-gradient-to-r from-[#054280] to-[#064ea2] rounded-xl p-6 text-white">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-white/60 text-xs mb-1">{assistData.model || 'AI Engine'}</p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-extrabold">{assistData.overall?.score ?? '-'}</span>
                          <span className="text-white/70 text-sm">/100</span>
                          <span className={`ml-2 text-sm font-bold px-3 py-0.5 rounded-full ${(assistData.overall?.level === '优秀') ? 'bg-emerald-400/30 text-emerald-100' : (assistData.overall?.level === '良好') ? 'bg-blue-400/30 text-blue-100' : (assistData.overall?.level === '合格') ? 'bg-amber-400/30 text-amber-100' : 'bg-red-400/30 text-red-100'}`}>
                            {assistData.overall?.level ?? '-'}
                          </span>
                        </div>
                      </div>
                      {assistData.generatedAt && (
                        <div className="text-right text-xs text-white/50">
                          <div>生成时间</div>
                          <div>{new Date(assistData.generatedAt).toLocaleTimeString('zh-CN')}</div>
                        </div>
                      )}
                    </div>
                    {/* 三维度分解条 */}
                    <div className="h-3 bg-white/10 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-300 flex items-center justify-center text-[10px] font-bold text-emerald-900"
                        style={{ width: `${assistData.overall?.breakdown?.compliance?.weight ?? 30}%` }}>
                        {assistData.overall?.breakdown?.compliance?.weight ?? 30}% 符合性
                      </div>
                      <div className="h-full bg-amber-300 flex items-center justify-center text-[10px] font-bold text-amber-900"
                        style={{ width: `${assistData.overall?.breakdown?.risk?.weight ?? 30}%` }}>
                        {assistData.overall?.breakdown?.risk?.weight ?? 30}% 风险
                      </div>
                      <div className="h-full bg-blue-300 flex items-center justify-center text-[10px] font-bold text-blue-900"
                        style={{ width: `${assistData.overall?.breakdown?.scoring?.weight ?? 40}%` }}>
                        {assistData.overall?.breakdown?.scoring?.weight ?? 40}% 评分
                      </div>
                    </div>
                  </div>

                  {/* 符合性检查 */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)]"><CheckCircle size={14} strokeWidth={1.5} /> 符合性检查</h3>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> 通过 {assistData.complianceCheck.items.filter((i: any) => i.status === 'pass').length}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 观察 {assistData.complianceCheck.items.filter((i: any) => i.status === 'warn').length}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> 不通过 {assistData.complianceCheck.items.filter((i: any) => i.status === 'fail').length}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {assistData.complianceCheck.items.map((item: any, i: number) => (
                        <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${item.status === 'pass' ? 'bg-emerald-50 border-emerald-200' : item.status === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${item.status === 'pass' ? 'bg-emerald-500' : item.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`}>
                            {item.status === 'pass' ? '✓' : item.status === 'warn' ? '⚠' : '✗'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</div>
                            <div className="text-xs text-[oklch(0.55_0.01_264)] truncate">{item.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 风险分析 — 含置信度 */}
                  <div>
                    <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><AlertTriangle size={14} strokeWidth={1.5} /> 多维风险分析</h3>
                    <div className="space-y-2">
                      {assistData.riskAnalysis.map((risk: any, i: number) => (
                        <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${risk.level === 'danger' ? 'bg-red-50 border-red-200' : risk.level === 'warning' ? 'bg-amber-50 border-amber-200' : risk.level === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                          <span className="text-lg flex-shrink-0">{risk.level === 'danger' ? '🚨' : risk.level === 'warning' ? <AlertTriangle size={16} strokeWidth={1.5} className="text-amber-500" /> : risk.level === 'success' ? <CheckCircle size={16} strokeWidth={1.5} className="text-emerald-500" /> : 'ℹ️'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-white">{risk.category}</span>
                              <span className="text-sm text-[oklch(0.18_0.012_265)]">{risk.content}</span>
                            </div>
                            {risk.confidence != null && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-white rounded-full overflow-hidden max-w-[120px]">
                                  <div className={`h-full rounded-full ${risk.confidence >= 85 ? 'bg-emerald-500' : risk.confidence >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${risk.confidence}%` }} />
                                </div>
                                <span className="text-[10px] text-[oklch(0.72_0.008_264)]">置信度 {risk.confidence}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 评分建议 — 含范围+置信度 */}
                  <div>
                    <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><Lightbulb size={14} strokeWidth={1.5} /> AI 评分建议</h3>
                    <div className="grid grid-cols-3 gap-4">
                      {assistData.scoreSuggestion.map((sug: any, i: number) => (
                        <div key={i} className="bg-white rounded-lg p-4 border border-blue-100 hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: CATEGORY_COLOR[sug.category], backgroundColor: CATEGORY_COLOR[sug.category] + '18' }}>
                              {CATEGORY_LABEL[sug.category] || sug.category}
                            </span>
                          </div>
                          <div className="text-xs text-[oklch(0.55_0.01_264)] mb-2">{sug.name}</div>
                          <div className="flex items-baseline gap-1 mb-2">
                            <span className="text-2xl font-bold text-[#064ea2]">{sug.suggestedScore}</span>
                            <span className="text-xs text-[oklch(0.55_0.01_264)]">/ {sug.maxScore ?? '-'} 分</span>
                          </div>
                          <div className="h-2 bg-[oklch(0.94_0.004_264)] rounded-full overflow-hidden mb-2">
                            {sug.maxScore > 0 && (
                              <div className="h-full bg-[#064ea2] rounded-full" style={{ width: `${(sug.suggestedScore / sug.maxScore) * 100}%` }} />
                            )}
                          </div>
                          <p className="text-[11px] text-[oklch(0.55_0.01_264)] mb-2">{sug.reason}</p>
                          {sug.confidence != null && (
                            <div className="flex items-center gap-1">
                              <div className="flex-1 h-1 bg-blue-100 rounded-full">
                                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${sug.confidence}%` }} />
                              </div>
                              <span className="text-[10px] text-[oklch(0.72_0.008_264)]">AI置信 {sug.confidence}%</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 关注要点 */}
                  <div className="bg-gradient-to-br from-blue-50 to-sky-50 rounded-xl border border-blue-100 p-5">
                    <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3"><Key size={14} strokeWidth={1.5} /> AI 评审关注要点</h3>
                    <ul className="space-y-2">
                      {assistData.keyPoints.map((point: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[oklch(0.18_0.012_265)]">
                          <span className="text-[#064ea2] mt-0.5 font-bold">{i + 1}.</span>{point}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">
                  <div className="text-4xl mb-3"><Sparkles size={14} strokeWidth={1.5} /></div>
                  <p>请先在左侧选择一个投标单位</p>
                  <p className="text-xs mt-1">AI 引擎将分析投标文件并生成辅助评估报告</p>
                </div>
              )}
            </div>
          )}

          {/* ====== 专家打分 ====== */}
          {step === 'scoring' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">专家独立打分</h2>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">请根据您的专业判断进行客观评分</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[oklch(0.55_0.01_264)]">评分对象：</label>
                  <select value={activeSupplier} onChange={e => { setActiveSupplier(e.target.value); setMissingReasons(new Set()); }}
                    className="text-sm border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-2 bg-white focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none">
                    {project.suppliers.map(s => <option key={s.id} value={s.id}>{s.supplierName}</option>)}
                  </select>
                </div>
              </div>

              {/* P0-3: draft recovery banner */}
              {draftAvailable && !draftDismissed && (
                <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-center gap-3">
                  <span className="text-lg">📝</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-amber-700">检测到未提交的评分草稿</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      {draftAvailable.count} 项评分 · 保存于 {new Date(draftAvailable.savedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <button onClick={discardDraft} className="px-3 py-1.5 text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition">丢弃</button>
                  <button onClick={restoreDraft} className="px-4 py-1.5 text-xs font-bold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition">恢复草稿</button>
                </div>
              )}

              {(() => {
                const grouped: Record<string, typeof project.scoreItems> = {};
                project.scoreItems.forEach(si => {
                  if (!grouped[si.category]) grouped[si.category] = [];
                  grouped[si.category].push(si);
                });
                const scoringSupplierName = project.suppliers.find(su => su.id === activeSupplier)?.supplierName || '';
                return (
                  <div className="space-y-6">
                    {Object.entries(grouped).map(([category, items]) => {
                      const catTotal = items.reduce((s, i) => s + Number(i.maxScore), 0);
                      const catScored = items.reduce((s, i) => s + (scores[scoreKey(activeSupplier, i.id)]?.score ?? 0), 0);
                      return (
                        <div key={category} className="bg-blue-50 rounded-xl border border-blue-100 overflow-hidden">
                          <div className="flex items-center justify-between p-4 border-b border-blue-100" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[category] || '#064ea2'}` }}>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ color: CATEGORY_COLOR[category] || '#064ea2', backgroundColor: (CATEGORY_COLOR[category] || '#064ea2') + '18' }}>
                                {CATEGORY_LABEL[category] || category}
                              </span>
                              <span className="text-sm text-[oklch(0.55_0.01_264)]">{items.length} 项</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-[oklch(0.55_0.01_264)]">得分</span>
                              <span className="text-lg font-bold" style={{ color: CATEGORY_COLOR[category] || '#064ea2' }}>{catScored}</span>
                              <span className="text-sm text-[oklch(0.55_0.01_264)]">/ {catTotal}</span>
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            {items.map(item => {
                              const k = scoreKey(activeSupplier, item.id);
                              const val = scores[k];
                              const currentScore = val?.score ?? 0;
                              const max = Number(item.maxScore);
                              const pct = max > 0 ? (currentScore / max) * 100 : 0;
                              const reasonMissing = missingReasons.has(item.id);
                              return (
                                <div key={item.id} data-score-item={item.id} className={`bg-white rounded-lg p-4 border ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                    <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                                  </div>
                                  <div className="flex items-center gap-4 mb-3">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                                      className="flex-1 h-2 bg-[oklch(0.94_0.004_264)] rounded-full appearance-none cursor-pointer accent-[#064ea2]"
                                      style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[k]?.reason || '' } }))}
                                      className="w-20 text-center border border-blue-100 rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none" />
                                  </div>
                                  <textarea placeholder="评分理由（低于满分必填）" value={val?.reason || ''}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setScores(prev => ({ ...prev, [k]: { score: prev[k]?.score ?? 0, reason: v } }));
                                      if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                    }}
                                    className={`w-full rounded-lg px-3 py-2 text-sm text-[oklch(0.18_0.012_265)] placeholder-[#b8c8d8] resize-none h-16 focus:outline-none ${reasonMissing ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-1 focus:ring-red-300' : 'border-blue-100 focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2]'}`} />
                                  {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 该项得分低于满分，请填写评分理由</p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* 汇总 */}
                    <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-[oklch(0.18_0.012_265)]">评分汇总 — {scoringSupplierName}</h3>
                        <div className="text-right">
                          <div className="text-3xl font-bold text-[#064ea2]">
                            {project.scoreItems.reduce((s, si) => s + (scores[scoreKey(activeSupplier, si.id)]?.score ?? 0), 0)}
                          </div>
                          <div className="text-sm text-[oklch(0.55_0.01_264)]">
                            满分 {project.scoreItems.reduce((s, si) => s + Number(si.maxScore), 0)}
                          </div>
                        </div>
                      </div>
                      {scoreLocked && (
                        <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
                          评审报告已确认，评分已锁定，不可再修改。
                        </div>
                      )}
                      {!canScoreActiveSupplier && !scoreLocked && (
                        <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
                          当前投标单位未解密成功或已撤回，不能提交评分。
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        {!scoreLocked && (
                          <button onClick={saveDraftNow} disabled={busy}
                            className="px-4 py-3 border border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] rounded-lg font-bold text-sm hover:bg-[oklch(0.992_0.003_264)] transition disabled:opacity-50">
                            保存草稿
                          </button>
                        )}
                        <button onClick={handleSubmitScores} disabled={busy || !canScoreActiveSupplier || scoreLocked}
                          className="flex-1 py-3 bg-[#064ea2] text-white rounded-lg font-bold text-sm hover:bg-[#054280] transition disabled:opacity-50">
                          {busy ? '提交中...' : scoreLocked ? '评分已锁定' : `提交 ${scoringSupplierName} 的评分`}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}



          {/* ====== 评审报告 ====== */}
          {step === 'report' && (
            <div className="p-6 max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">评审报告</h2>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">查看评审结果汇总，确认后不可修改</p>
                </div>
                {report?.canConfirm && (
                  <button onClick={handleConfirmReport} disabled={busy}
                    className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 transition disabled:opacity-50">
                    {busy ? '确认中...' : '✓ 确认评审报告'}
                  </button>
                )}
              </div>

              {report ? (
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-[#054280] to-[#064ea2] text-white rounded-xl p-6">
                    <h3 className="text-xl font-bold mb-2">{report.projectName}</h3>
                    <div className="flex items-center gap-6 text-sm text-white/80">
                      <span>项目编号：{report.projectCode}</span>
                      <span>评审专家：{report.expertName}</span>
                      <span>完成度：{report.expertProgress}%</span>
                    </div>
                  </div>

                  {report.supplierScores.map((ss, i) => (
                    <div key={i} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] overflow-hidden">
                      <div className="flex items-center justify-between p-5 border-b border-[oklch(0.91_0.006_264)]">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white font-bold text-sm">{i + 1}</div>
                          <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{ss.supplierName}</h3>
                          {ss.completed && <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-semibold">评分完整</span>}
                        </div>
                        <div className="text-2xl font-bold text-[#064ea2]">{ss.totalScore} <span className="text-sm text-[oklch(0.55_0.01_264)] font-normal">分</span></div>
                      </div>
                      {Object.entries(ss.categoryScores).length > 0 && (
                        <div className="p-5 grid grid-cols-3 gap-3">
                          {Object.entries(ss.categoryScores).map(([cat, data]) => (
                            <div key={cat} className="bg-blue-50 rounded-lg p-3" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[cat] || '#064ea2'}` }}>
                              <div className="text-xs font-semibold mb-1" style={{ color: CATEGORY_COLOR[cat] || '#064ea2' }}>{CATEGORY_LABEL[cat] || cat}</div>
                              <div className="text-lg font-bold text-[oklch(0.18_0.012_265)]">{data.total} <span className="text-xs text-[oklch(0.55_0.01_264)] font-normal">/ {data.max}</span></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {!report.canConfirm && (
                    <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 flex items-center gap-3">
                      <span className="text-xl"><AlertTriangle size={14} strokeWidth={1.5} /></span>
                      <p className="text-sm text-amber-600">请先完成所有供应商的评分后再确认报告</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">加载报告数据...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
