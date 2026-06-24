'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useExpertWebSocket } from '@/hooks/use-expert-websocket';
import { LiveStatusBoard } from '@/components/live-status-board';
import type { ExpertProjectDetail, DecryptedDocuments, AssistData, EvaluationReport } from '@/lib/types';
import { isPassFailCategory } from '@water-erp/shared';
import { ShieldCheck, FileText, Sparkles, Edit3, BarChart3, Lock, Unlock, Download, AlertTriangle, CheckCircle, Lightbulb, Key, Clipboard, Gavel, MessageSquare } from 'lucide-react';

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
  // Phone verification
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeError, setCodeError] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  // P0: auto-verify on first 6-digit input only; disable after first failure
  const autoVerifyRef = useRef(true);
  // P2: clarifications panel
  const [showClarifications, setShowClarifications] = useState(false);
  const [clarifications, setClarifications] = useState<any[]>([]);
  const [clarQuestion, setClarQuestion] = useState('');
  const [clarSupplier, setClarSupplier] = useState('');
  const [clarSupplierId, setClarSupplierId] = useState('');
  const [clarPosting, setClarPosting] = useState(false);
  // P3: real-time status board
  const [liveEvents, setLiveEvents] = useState<{ time: number; label: string; icon: 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify' }[]>([]);
  const [aggregatePresence, setAggregatePresence] = useState<any>(null);

  const pushLiveEvent = (label: string, icon: typeof liveEvents[0]['icon']) => {
    setLiveEvents(prev => [{ time: Date.now(), label, icon }, ...prev].slice(0, 20));
  };

  // P5: keyboard navigation for scoring — Enter on last item's reason submits
  const handleScoringKeyDown = (e: React.KeyboardEvent, isLastItem: boolean) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || isLastItem)) {
      e.preventDefault();
      handleSubmitScores();
    }
  };

  // P0: request sequence counter to discard stale responses on rapid supplier switching
  const docSeqRef = useRef(0);
  const assistSeqRef = useRef(0);

  const { connection: _wsConn, lastEventAt: _wsLastEvent, reconnectNow: _wsReconnect } = useExpertWebSocket(projectId, {
    onAggregatePresence: (d: any) => {
      setAggregatePresence(d);
      // P3-4: notify when all experts have confirmed reports
      if (d.reportConfirmedCount === d.totalExperts && d.totalExperts > 0) {
        toast.success('所有专家已完成评审报告确认');
      }
    },
    onDecryptStatus: (d: any) => {
      pushLiveEvent(`${d.supplierName} 解密${d.decryptStatus === 'SUCCESS' ? '成功' : '异常'}`, 'decrypt');
      // P3-4: auto-refresh documents when decrypt status changes
      if (activeSupplier) loadDocuments(activeSupplier);
    },
    onStageChange: (d: any) => {
      pushLiveEvent(`项目阶段: ${d.from} → ${d.to}`, 'stage');
      // P3-4: reload project data on stage transitions
      loadProject();
    },
    onClarificationCreated: (d: any) => {
      pushLiveEvent(`新澄清: ${d.questionPreview.slice(0, 30)}`, 'clarify');
      // P3-4: refresh clarifications if panel is open
      if (showClarifications) loadClarifications();
    },
    onClarificationReplied: (d: any) => {
      pushLiveEvent(`澄清已回复: ${d.replyPreview.slice(0, 30)}`, 'clarify');
      if (showClarifications) loadClarifications();
    },
  });

  const [documents, setDocuments] = useState<DecryptedDocuments | null>(null);
  const [assistData, setAssistData] = useState<AssistData | null>(null);
  const [assistLoading, setAssistLoading] = useState(false);
  // P0-1: scores keyed by `${supplierId}:${scoreItemId}` (composite) — never flat by scoreItemId.
  const [scores, setScores] = useState<Record<string, { score: number; reason: string; passed?: boolean }>>({});
  const [report, setReport] = useState<EvaluationReport | null>(null);

  const [confidentialityAgreed, setConfidentialityAgreed] = useState(false);
  const [disciplineAgreed, setDisciplineAgreed] = useState(false);
  // P2: per-supplier conflict declaration
  const [conflictedSupplierIds, setConflictedSupplierIds] = useState<Set<string>>(new Set());
  const [avoiding, setAvoiding] = useState(false);

  // P2: step gating — each step is unlocked only when its preconditions are met
  const stepAccessible = (sKey: Step): boolean => {
    switch (sKey) {
      case 'verify': return true;
      case 'documents': return !!expert?.signedIn;
      case 'assist': return !!expert?.signedIn;
      case 'scoring': return !!expert?.signedIn && !!expert?.avoidanceConfirmed;
      case 'report': return !!expert?.reportConfirmed || (expert?.progress ?? 0) >= 100;
    }
  };
  const stepCompleted = (sKey: Step): boolean => {
    switch (sKey) {
      case 'verify': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && confidentialityAgreed && disciplineAgreed;
      case 'documents': return false; // no "complete" state for browsing docs
      case 'assist': return false;
      case 'scoring': return !!expert?.reportConfirmed;
      case 'report': return !!expert?.reportConfirmed;
    }
  };

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
    api.get<ExpertProjectDetail & { restricted?: boolean }>(`/expert/projects/${projectId}`)
      .then(p => {
        // Stage gate: redirect if project is not in an active review stage
        if (p.restricted || (p.stage !== 'OPENING' && p.stage !== 'EVALUATING')) {
          toast.error('该项目尚未进入开评标阶段');
          router.replace('/projects');
          return;
        }
        setProject(p);
        // P0-1: hydrate with composite keys so each supplier's scores are isolated.
        const existing: Record<string, { score: number; reason: string }> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = { score: Number(rec.score), reason: rec.reason || '' };
        });
        setScores(existing);
        // P2: sync per-supplier conflicts from server
        const serverConflicts: string[] = p.myExpertRecord?.conflictedSupplierIds || [];
        if (serverConflicts.length > 0) setConflictedSupplierIds(new Set(serverConflicts));
      })
      .catch((e: any) => toast.error(e?.message || '加载项目失败'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // P3-3: default supplier selection decoupled from project load — avoids re-fetch on switch
  useEffect(() => {
    if (project && project.suppliers.length > 0 && !activeSupplier) {
      setActiveSupplier(project.suppliers[0].id);
    }
  }, [project, activeSupplier]);

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

  // Sync phone verification state from project data
  useEffect(() => {
    if (project?.myExpertRecord) {
      setPhoneMasked(project.myExpertRecord.phoneMasked ?? null);
      setPhoneVerified(project.myExpertRecord.phoneVerified ?? false);
    }
  }, [project]);

  const expert = project?.myExpertRecord;

  const handleSignIn = async () => {
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/sign-in`, {}); loadProject(); }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    setBusy(false);
  };

  // Phone verification handlers
  const handleSendCode = async () => {
    if (countdown > 0) return;
    setSendingCode(true);
    setCodeError('');
    try {
      const res = await api.post('/verification/send-code', {
        scene: 'expert_sign_in',
        targetId: projectId,
      });
      setPhoneMasked((res as any).maskedPhone);
      setCodeSent(true);
      setCountdown(60);
      setAttemptsLeft(5);
      setVerificationCode('');
      autoVerifyRef.current = true; // re-enable auto-verify on new code
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      toast.error(e.data?.error || e.message || '发送失败');
    }
    setSendingCode(false);
  };

  const handleVerifyCode = async (code: string) => {
    if (!code || code.length !== 6) return;
    setVerifying(true);
    setCodeError('');
    try {
      await api.post('/verification/verify-code', {
        scene: 'expert_sign_in',
        targetId: projectId,
        code,
      });
      setPhoneVerified(true);
      toast.success('手机验证通过');
    } catch (e: any) {
      const data = e.data;
      setCodeError(data?.error || '验证失败');
      autoVerifyRef.current = false; // disable auto-verify after first failure
      if (data?.code === 'ATTEMPTS_EXCEEDED' || data?.code === 'CODE_EXPIRED') {
        setCodeSent(false);
        setVerificationCode('');
      }
      const match = data?.error?.match(/剩余 (\d+) 次/);
      if (match) setAttemptsLeft(parseInt(match[1], 10));
    }
    setVerifying(false);
  };

  const handleAvoidance = async () => {
    setAvoiding(true);
    try {
      await api.post(`/expert/projects/${projectId}/avoidance`, { conflictedSupplierIds: [...conflictedSupplierIds] });
      loadProject();
    }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    setAvoiding(false);
  };

  const loadDocuments = async (sid: string) => {
    const seq = ++docSeqRef.current;
    try {
      const data = await api.get<DecryptedDocuments>(`/expert/projects/${projectId}/documents/${sid}`);
      if (seq === docSeqRef.current) setDocuments(data);
    }
    catch (e: any) { if (seq === docSeqRef.current) toast.error(e.message || '加载标书失败'); }
  };

  const loadClarifications = async () => {
    try { setClarifications(await api.get<any[]>(`/expert/projects/${projectId}/clarifications`)); }
    catch { setClarifications([]); }
  };

  const postClarification = async () => {
    if (!clarQuestion.trim()) { toast.error('请输入问题'); return; }
    if (!clarSupplier) { toast.error('请选择目标供应商'); return; }
    setClarPosting(true);
    try { await api.post(`/expert/projects/${projectId}/clarifications`, { question: clarQuestion, supplierName: clarSupplier, supplierId: clarSupplierId || undefined }); toast.success('澄清已发起'); setClarQuestion(''); loadClarifications(); }
    catch (e: any) { toast.error(e.message || '发起失败'); }
    setClarPosting(false);
  };

  const loadAssist = async (sid: string) => {
    const seq = ++assistSeqRef.current;
    setAssistLoading(true);
    try {
      const data = await api.get<AssistData>(`/expert/projects/${projectId}/assist/${sid}`);
      if (seq === assistSeqRef.current) { setAssistData(data); setAssistLoading(false); }
    }
    catch (e: any) { if (seq === assistSeqRef.current) { toast.error(e.message || '加载AI数据失败'); setAssistLoading(false); } }
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
    const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回'
    // P2: also block if expert declared conflict with this supplier
    && !conflictedSupplierIds.has(activeSupplier)
    && !(project?.myExpertRecord?.conflictedSupplierIds || []).includes(activeSupplier);
    if (!canScoreActiveSupplier) {
      toast.warning('该投标单位未解密成功或已撤回，不能评分');
      return;
    }
    const missing: string[] = [];
    for (const si of project.scoreItems) {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      if (isPassFailCategory(si.category)) {
        if (typeof entry?.passed !== 'boolean' || (entry.passed === false && !(entry.reason || '').trim())) {
          missing.push(si.id);
        }
      } else {
        const score = entry?.score ?? 0;
        if (score < Number(si.maxScore) && !(entry?.reason || '').trim()) missing.push(si.id);
      }
    }
    if (missing.length > 0) {
      setMissingReasons(new Set(missing));
      toast.warning(`有评分项未完成，已高亮标记，请补充后再提交`);
      const firstEl = document.querySelector(`[data-score-item="${missing[0]}"]`);
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setMissingReasons(new Set()); // clear on valid submit
    const scoresPayload = project.scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      if (isPassFailCategory(si.category)) {
        return { scoreItemId: si.id, supplierId: activeSupplier, passed: entry?.passed, reason: entry?.reason ?? '' };
      }
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
    if (!confirm('确认后将锁定所有评分，不可再修改。是否继续？')) return;
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/report/confirm`, { comment: '确认完成评审' }); loadProject(); toast.success('评审报告已确认'); }
    catch (e: any) { toast.error(e.message || '确认失败'); }
    setBusy(false);
  };

  if (loading || !project) return <div className="flex items-center justify-center h-64 text-[oklch(0.55_0.01_264)]">加载中...</div>;

  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '已解密', DANGER: '异常' };
  const activeSupplierRecord = project.suppliers.find(s => s.id === activeSupplier);
  const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回'
    // P2: also block if expert declared conflict with this supplier
    && !conflictedSupplierIds.has(activeSupplier)
    && !(project?.myExpertRecord?.conflictedSupplierIds || []).includes(activeSupplier);
  const scoreLocked = !!expert?.reportConfirmed;

  const formatBytes = (n: number) => {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* P3: disconnected banner */}
      {_wsConn !== 'connected' && (
        <div className={`mb-3 px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between flex-shrink-0 ${
          _wsConn === 'reconnecting' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          <span>⚠ {_wsConn === 'reconnecting' ? '实时连接中断，正在重连…' : '实时连接已断开，数据可能不是最新'}</span>
          <button onClick={_wsReconnect} className="underline hover:no-underline">重试</button>
        </div>
      )}

      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/projects')} className="text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] transition">← 返回</button>
          <div className="w-px h-6 bg-white/30" />
          <h1 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">{project.name}</h1>
          <span className="text-sm text-[oklch(0.55_0.01_264)]">{project.projectCode}</span>
        </div>
        <div className="flex items-center gap-3">
          <LiveStatusBoard
            connection={_wsConn} lastEventAt={_wsLastEvent} onReconnect={_wsReconnect}
            aggregate={aggregatePresence} events={liveEvents}
          />
        </div>
        <button onClick={() => { setShowClarifications(!showClarifications); if (!showClarifications) loadClarifications(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-xs font-bold text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] hover:border-[#064ea2] transition">
          <MessageSquare size={13} strokeWidth={1.5} /> 澄清答疑
        </button>
      </div>

      {/* P2: clarifications panel (toggled from header) */}
      {showClarifications && (
        <div className="glass-card glass-card-purple rounded-xl p-5 mb-4 flex-shrink-0 space-y-3 max-h-[300px] !overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]"><MessageSquare size={14} strokeWidth={1.5} className="inline mr-1" />澄清与答疑</h3>
            <button onClick={() => setShowClarifications(false)} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)]">✕</button>
          </div>
          {clarifications.length === 0 ? (
            <p className="text-xs text-[oklch(0.62_0.008_264)] text-center py-4">暂无澄清记录</p>
          ) : (
            <div className="space-y-2">
              {clarifications.map((c: any) => (
                <div key={c.id} className="border border-[oklch(0.91_0.006_264)] rounded-lg p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-[oklch(0.18_0.012_265)]">{c.issuer}</span>
                    <span className="text-[oklch(0.62_0.008_264)]">→ {c.supplierName}</span>
                    <span className="ml-auto text-[10px] text-[oklch(0.62_0.008_264)]">{new Date(c.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="text-[oklch(0.18_0.012_265)] mb-1">Q: {c.question}</p>
                  {c.reply ? (
                    <p className="text-[#11a874] bg-emerald-50 rounded p-1.5">A: {c.reply}</p>
                  ) : (
                    <p className="text-[oklch(0.72_0.008_264)] italic">待回复</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Post new question */}
          <div className="border-t border-[oklch(0.91_0.006_264)] pt-3 space-y-2">
            <select value={clarSupplier} onChange={e => {
                const sel = project.suppliers.find(s => s.supplierName === e.target.value);
                setClarSupplier(e.target.value);
                setClarSupplierId(sel?.supplierId || '');
              }}
              className="w-full border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-1.5 text-xs bg-white/60 focus:outline-none focus:border-[#064ea2]">
              <option value="">选择供应商（必选）</option>
              {project.suppliers.map(s => (
                <option key={s.id} value={s.supplierName}>{s.supplierName}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input value={clarQuestion} onChange={e => setClarQuestion(e.target.value)}
                placeholder="向所选供应商发起澄清…"
                onKeyDown={e => e.key === 'Enter' && postClarification()}
                className="flex-1 border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-1.5 text-xs bg-white/60 focus:outline-none focus:border-[#064ea2]" />
              <button onClick={postClarification} disabled={clarPosting}
                className="px-3 py-1.5 bg-[#064ea2] text-white text-xs font-bold rounded-lg hover:bg-[#054280] transition disabled:opacity-50">
                {clarPosting ? '…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 步骤指示器 · P2: step gating — locked steps show lock icon, completed show checkmark */}
      <div className="glass-card glass-card-blue rounded-xl p-4 mb-4 flex-shrink-0">
        <div className="flex items-center">
          {STEPS.map((s, i) => {
            const accessible = stepAccessible(s.key);
            const completed = stepCompleted(s.key);
            const isCurrent = step === s.key;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <button onClick={() => { if (accessible) setStep(s.key); }}
                  disabled={!accessible}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={!accessible && !completed ? `${s.label}（需先完成前置步骤）` : s.label}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-semibold ${
                    isCurrent ? 'bg-[#064ea2] text-white shadow-md'
                    : completed ? 'text-[#11a874] bg-emerald-50 border border-emerald-100'
                    : accessible ? 'text-[oklch(0.55_0.01_264)] hover:bg-blue-50'
                    : 'text-[oklch(0.72_0.008_264)] cursor-not-allowed'
                  }`}>
                  {completed ? <CheckCircle size={14} strokeWidth={1.5} className="text-[#11a874]" aria-hidden="true" />
                   : !accessible ? <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
                   : <s.Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-white/30 mx-2" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        {/* 左侧供应商列表 */}
        <div className="w-56 flex-shrink-0 glass-card glass-card-purple rounded-xl !overflow-y-auto">
          <div className="p-4 border-b border-[oklch(0.91_0.006_264)]">
            <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]">投标单位</h3>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mt-1">{project.suppliers.length} 家</p>
          </div>
          <div className="p-2">
            {project.suppliers.map(s => (
              <button key={s.id} onClick={() => { setActiveSupplier(s.id); setMissingReasons(new Set()); }}
                disabled={conflictedSupplierIds.has(s.id) && step !== 'verify'}
                className={`w-full text-left p-3 rounded-lg mb-1 text-sm transition-all ${activeSupplier === s.id ? 'bg-blue-50 border border-[#bfdbfe]' : 'hover:bg-[oklch(0.992_0.003_264)] border border-transparent'}`}>
                <div className="font-semibold text-[oklch(0.18_0.012_265)] truncate">{s.supplierName}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.decryptStatus === 'SUCCESS' ? 'bg-[#11a874]' : s.decryptStatus === 'DANGER' ? 'bg-[#e74c3c]' : 'bg-[#f5a623]'}`} />
                  <span className="text-xs text-[oklch(0.55_0.01_264)]">{decryptLabel[s.decryptStatus] || s.decryptStatus}</span>
                  {conflictedSupplierIds.has(s.id) && (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">已回避</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右侧主内容 */}
        <div className="flex-1 glass-card glass-card-blue rounded-xl !overflow-y-auto">
          {/* ====== 身份核验 ====== */}
          {step === 'verify' && (
            <div className="p-6 max-w-3xl mx-auto">
              <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)] mb-6">身份核验与承诺确认</h2>

              <div className="space-y-4 mb-6">
                {/* ===== ① 身份核验 — 始终可用 ===== */}
                <div>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${expert?.signedIn ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[oklch(0.91_0.006_264)]'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${expert?.signedIn ? 'bg-emerald-500 text-white' : 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'}`}>
                      {expert?.signedIn ? '✓' : '1'}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${expert?.signedIn ? 'text-emerald-600' : 'text-[oklch(0.18_0.012_265)]'}`}>身份核验</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">确认您的专家身份信息</p>
                    </div>
                    {!expert?.signedIn && (
                      <span className="text-xs text-[oklch(0.72_0.008_264)] bg-[oklch(0.96_0.004_264)] px-2 py-1 rounded font-semibold">待完成</span>
                    )}
                  </div>
                  {/* 手机验证 + 签到 — 未签到时显示 */}
                  {!expert?.signedIn && (
                    <div className="mt-3 p-4 glass-card glass-card-lighter glass-card-blue rounded-xl">
                      {!phoneMasked && !codeSent ? (
                        <div className="text-center py-2">
                          <p className="text-sm text-[oklch(0.55_0.01_264)] mb-2">未绑定手机号，请联系管理员完善资料</p>
                        </div>
                      ) : phoneVerified ? (
                        <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <span className="text-lg">✅</span>
                          <div>
                            <p className="text-sm font-semibold text-emerald-600">手机验证通过</p>
                            <p className="text-xs text-emerald-500">{phoneMasked}</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">📱 手机验证</p>
                          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-3">
                            验证码将发送至 {phoneMasked || '注册手机号'}
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={verificationCode}
                              onChange={e => {
                                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                                setVerificationCode(v);
                                setCodeError('');
                                // Only auto-verify on first attempt; after failure, user must manually confirm
                                if (v.length === 6 && autoVerifyRef.current) handleVerifyCode(v);
                              }}
                              placeholder="输入6位验证码"
                              disabled={verifying || !codeSent}
                              className="flex-1 px-3 py-2 text-center text-lg tracking-[8px] border border-[oklch(0.91_0.006_264)] rounded-lg focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none disabled:opacity-50 font-mono"
                            />
                            <button
                              onClick={handleSendCode}
                              disabled={sendingCode || countdown > 0 || verifying}
                              className="px-4 py-2 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50 whitespace-nowrap"
                            >
                              {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : codeSent ? '重新获取' : '获取验证码'}
                            </button>
                          </div>
                          {codeError && (
                            <p className="mt-2 text-xs text-red-500">{codeError}</p>
                          )}
                          {!codeError && codeSent && !phoneVerified && (
                            <p className="mt-2 text-xs text-[oklch(0.55_0.01_264)]">
                              验证码6位数字，5分钟内有效
                              {attemptsLeft < 5 && ` · 剩余 ${attemptsLeft} 次尝试`}
                            </p>
                          )}
                        </>
                      )}
                      {/* 签到按钮 — 手机验证通过后显示 */}
                      {phoneVerified && (
                        <button
                          onClick={handleSignIn}
                          disabled={busy}
                          className="mt-3 w-full px-4 py-2.5 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50 font-semibold"
                        >
                          {busy ? '请稍候…' : '确认签到并完成身份核验'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* ===== ② 保密承诺 — 签到完成后解锁 ===== */}
                <div className={!expert?.signedIn ? 'opacity-50 pointer-events-none select-none' : ''}>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    confidentialityAgreed ? 'bg-emerald-50 border-emerald-200'
                    : expert?.signedIn ? 'bg-white/70 border-[oklch(0.91_0.006_264)]'
                    : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      confidentialityAgreed ? 'bg-emerald-500 text-white'
                      : expert?.signedIn ? 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'
                      : 'bg-gray-200 text-gray-400'
                    }`}>
                      {confidentialityAgreed ? '✓' : expert?.signedIn ? '2' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        confidentialityAgreed ? 'text-emerald-600'
                        : expert?.signedIn ? 'text-[oklch(0.18_0.012_265)]'
                        : 'text-gray-400'
                      }`}>保密承诺</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">承诺不泄露评标过程中获取的信息</p>
                    </div>
                    {!expert?.signedIn && (
                      <span className="text-xs text-[oklch(0.72_0.008_264)] bg-[oklch(0.96_0.004_264)] px-2 py-1 rounded font-semibold">需先完成身份核验</span>
                    )}
                    {expert?.signedIn && !confidentialityAgreed && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-semibold">待签署</span>
                    )}
                  </div>
                  {/* 保密承诺书 — 解锁后且未签署时显示 */}
                  {expert?.signedIn && !confidentialityAgreed && (
                    <div className="mt-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 flex items-center gap-2">
                        <Clipboard size={14} strokeWidth={1.5} /> 保密承诺书
                      </h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)] leading-relaxed mb-4">
                        本人作为本项目评审专家，郑重承诺：在评标过程中严格遵守保密规定，不向任何第三方泄露评标过程中获取的投标文件内容、评审意见及其他相关信息。如有违反，愿意承担相应法律责任。
                      </p>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={confidentialityAgreed} onChange={e => setConfidentialityAgreed(e.target.checked)}
                          className="w-4 h-4 rounded border-blue-200 text-[#064ea2] focus:ring-[#064ea2]" />
                        <span className="text-sm text-[oklch(0.18_0.012_265)] font-semibold">本人已阅读并同意以上保密承诺</span>
                      </label>
                    </div>
                  )}
                  {/* 已签署确认条 */}
                  {expert?.signedIn && confidentialityAgreed && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="text-emerald-500" />
                      <span className="text-sm text-emerald-600 font-semibold">已签署保密承诺书</span>
                    </div>
                  )}
                </div>

                {/* ===== ③ 评标纪律 — 保密承诺签署后解锁 ===== */}
                <div className={!confidentialityAgreed ? 'opacity-50 pointer-events-none select-none' : ''}>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    disciplineAgreed ? 'bg-emerald-50 border-emerald-200'
                    : confidentialityAgreed ? 'bg-white/70 border-[oklch(0.91_0.006_264)]'
                    : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      disciplineAgreed ? 'bg-emerald-500 text-white'
                      : confidentialityAgreed ? 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'
                      : 'bg-gray-200 text-gray-400'
                    }`}>
                      {disciplineAgreed ? '✓' : confidentialityAgreed ? '3' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        disciplineAgreed ? 'text-emerald-600'
                        : confidentialityAgreed ? 'text-[oklch(0.18_0.012_265)]'
                        : 'text-gray-400'
                      }`}>评标纪律</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">遵守独立评审原则</p>
                    </div>
                    {!confidentialityAgreed && (
                      <span className="text-xs text-[oklch(0.72_0.008_264)] bg-[oklch(0.96_0.004_264)] px-2 py-1 rounded font-semibold">需先签署保密承诺</span>
                    )}
                    {confidentialityAgreed && !disciplineAgreed && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-semibold">待确认</span>
                    )}
                  </div>
                  {/* 评标纪律 — 解锁后且未确认时显示 */}
                  {confidentialityAgreed && !disciplineAgreed && (
                    <div className="mt-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 flex items-center gap-2">
                        <Gavel size={14} strokeWidth={1.5} /> 评标纪律承诺
                      </h3>
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
                  )}
                  {/* 已确认条 */}
                  {confidentialityAgreed && disciplineAgreed && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="text-emerald-500" />
                      <span className="text-sm text-emerald-600 font-semibold">已确认评标纪律</span>
                    </div>
                  )}
                </div>
              </div>

              {/* P2: per-supplier avoidance declaration */}
              {!expert?.avoidanceConfirmed && (
                <div className="mt-6 bg-amber-50 rounded-xl border border-amber-200 p-5">
                  <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 flex items-center gap-2">
                    <Lock size={14} strokeWidth={1.5} className="text-amber-600" /> 利益冲突回避
                  </h3>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mb-4">
                    请逐项核对：若您与以下任一投标单位存在利益关系（如曾受雇、近亲属供职、持有股份等），请勾选声明回避。
                    被回避的供应商将不会出现在您的评分列表中。
                  </p>
                  <div className="space-y-1.5 mb-4">
                    {project.suppliers.map(sup => {
                      const isConflict = conflictedSupplierIds.has(sup.id);
                      return (
                        <label key={sup.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition ${
                            isConflict ? 'bg-red-50 border border-red-200' : 'hover:bg-white border border-transparent'
                          }`}>
                          <input type="checkbox" checked={isConflict}
                            onChange={e => {
                              setConflictedSupplierIds(prev => {
                                const n = new Set(prev);
                                e.target.checked ? n.add(sup.id) : n.delete(sup.id);
                                return n;
                              });
                            }}
                            className="w-4 h-4 rounded border-amber-300 text-[#e74c3c] focus:ring-[#e74c3c]" />
                          <span className="flex-1 text-sm font-semibold text-[oklch(0.18_0.012_265)]">{sup.supplierName}</span>
                          {isConflict && <span className="text-xs font-bold text-red-500">已声明回避</span>}
                        </label>
                      );
                    })}
                  </div>
                  <button onClick={handleAvoidance} disabled={avoiding}
                    className="px-5 py-2.5 bg-[#f5a623] text-white rounded-lg font-bold text-sm hover:bg-amber-600 transition disabled:opacity-50">
                    {avoiding ? '提交中…' : `确认回避声明（${conflictedSupplierIds.size} 家冲突 / ${project.suppliers.length - conflictedSupplierIds.size} 家无冲突）`}
                  </button>
                </div>
              )}

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
                  <div className="mb-3"><FileText size={40} strokeWidth={1} className="text-[#cbd5e1]" /></div>
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
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-white/70">{risk.category}</span>
                              <span className="text-sm text-[oklch(0.18_0.012_265)]">{risk.content}</span>
                            </div>
                            {risk.confidence != null && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden max-w-[120px]">
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
                        <div key={i} className="glass-card glass-card-lighter glass-card-blue rounded-lg p-4 hover:shadow-md transition-shadow">
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
                              <div className="h-full bg-[#064ea2]/60 rounded-full" style={{ width: `${(sug.suggestedScore / sug.maxScore) * 100}%` }} />
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
              ) : assistLoading ? (
                <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">
                  <div className="mb-4"><Sparkles size={40} strokeWidth={1} className="text-[#064ea2] animate-pulse" /></div>
                  <p className="font-semibold text-[oklch(0.18_0.012_265)]">AI 正在分析投标文件…</p>
                  <p className="text-xs mt-1">正在生成合规性检查、风险分析与评分建议，请耐心等待</p>
                  <div className="mt-4 flex justify-center gap-1">
                    {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-[#064ea2]/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">
                  <div className="mb-3"><Sparkles size={40} strokeWidth={1} className="text-[#cbd5e1]" /></div>
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
                    className="text-sm border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-2 bg-white/60 focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none">
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
                // P2: grouped computation moved outside render — kept inline for minimal diff
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
                              {isPassFailCategory(category) ? (
                                <span className="text-sm font-bold text-[oklch(0.55_0.01_264)]">通过性审查</span>
                              ) : (
                                <>
                                  <span className="text-sm text-[oklch(0.55_0.01_264)]">得分</span>
                                  <span className="text-lg font-bold" style={{ color: CATEGORY_COLOR[category] || '#064ea2' }}>{catScored}</span>
                                  <span className="text-sm text-[oklch(0.55_0.01_264)]">/ {catTotal}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            {items.map(item => {
                              const k = scoreKey(activeSupplier, item.id);
                              const val = scores[k];
                              const reasonMissing = missingReasons.has(item.id);
                              const passFail = isPassFailCategory(item.category);
                              if (passFail) {
                                const verdict = val?.passed;
                                return (
                                  <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)] mb-3">{item.name}</h4>
                                    <div className="flex items-center gap-3 mb-3">
                                      {[
                                        { v: true, label: '通过', cls: verdict === true ? 'bg-[#11a874] text-white border-[#11a874]' : 'bg-white text-[#11a874] border-[#11a874]/40 hover:bg-[#ecfdf5]' },
                                        { v: false, label: '不通过', cls: verdict === false ? 'bg-[#e74c3c] text-white border-[#e74c3c]' : 'bg-white text-[#e74c3c] border-[#e74c3c]/40 hover:bg-[#fef2f2]' },
                                      ].map(opt => (
                                        <button key={String(opt.v)} type="button"
                                          onClick={() => setScores(prev => ({ ...prev, [k]: { score: 0, reason: prev[k]?.reason || '', passed: opt.v } }))}
                                          className={`px-5 py-2 rounded-lg text-sm font-bold border transition ${opt.cls}`}>
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                    {verdict === false && (
                                      <textarea placeholder="不通过理由（必填）" value={val?.reason || ''}
                                        onChange={e => {
                                          const v = e.target.value;
                                          setScores(prev => ({ ...prev, [k]: { score: 0, reason: v, passed: false } }));
                                          if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                        }}
                                        className={`w-full rounded-lg px-3 py-2 text-sm text-[oklch(0.18_0.012_265)] resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                        aria-label={`${item.name} 不通过理由`} />
                                    )}
                                    {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 请选择「通过 / 不通过」，不通过需填理由</p>}
                                  </div>
                                );
                              }
                              // 数值项：保持原渲染
                              const currentScore = val?.score ?? 0;
                              const max = Number(item.maxScore);
                              const pct = max > 0 ? (currentScore / max) * 100 : 0;
                              return (
                                <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                    <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                                  </div>
                                  <div className="flex items-center gap-4 mb-3">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                                      className="flex-1 h-2 bg-[oklch(0.94_0.004_264)] rounded-full appearance-none cursor-pointer accent-[#064ea2]"
                                      style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }}
                                      aria-label={`${item.name} 评分`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={currentScore} tabIndex={0} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[k]?.reason || '' } }))}
                                      className="w-20 text-center border border-blue-100 rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2] outline-none"
                                      aria-label={`${item.name} 数值输入`} tabIndex={0} />
                                  </div>
                                  <textarea placeholder="评分理由（低于满分必填）" value={val?.reason || ''}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setScores(prev => ({ ...prev, [k]: { score: prev[k]?.score ?? 0, reason: v } }));
                                      if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                    }}
                                    className={`w-full rounded-lg px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                    aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                  {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 该项得分低于满分，请填写评分理由</p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* 汇总 */}
                    <div className="glass-card glass-card-blue rounded-xl p-6">
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
                    <div key={i} className="glass-card glass-card-blue rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between p-5 border-b border-[oklch(0.91_0.006_264)]">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white font-bold text-sm">{i + 1}</div>
                          <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{ss.supplierName}</h3>
                          {ss.perSupplierComplete && <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-semibold">评分完整</span>}
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

                  {!report.overallComplete && (
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
