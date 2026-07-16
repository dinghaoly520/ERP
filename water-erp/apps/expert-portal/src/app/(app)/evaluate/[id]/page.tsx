'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { useExpertWebSocket } from '@/hooks/use-expert-websocket';
import { LiveStatusBoard } from '@/components/live-status-board';
import type { ExpertProjectDetail, DecryptedDocuments, AssistData, EvaluationReport } from '@/lib/types';
import { isPassFailCategory, CATEGORY_LABEL, CATEGORY_COLOR, DECRYPT_LABEL } from '@water-erp/shared';
import { ArrowLeft, Check, ShieldCheck, FileText, Sparkles, Edit3, BarChart3, Lock, Unlock, Download, AlertTriangle, CheckCircle, Lightbulb, Key, Clipboard, ClipboardList, Gavel, MessageSquare, Phone, X, Scale, StickyNote } from 'lucide-react';
import { AssistPanel } from '@/components/evaluate/assist/assist-panel';
import { RequirementComparePanel } from '@/components/evaluate/assist/requirement-compare-panel';
import { SupplierSidebar } from '@/components/evaluate/supplier-sidebar';
import { DocumentsStep } from '@/components/evaluate/documents-step';
import { ReportStep } from '@/components/evaluate/report-step';
import { VerifyScoreStep } from '@/components/evaluate/verify-score-step';
import { PointChecklistScoring } from '@/components/evaluate/point-checklist-scoring';
import { MemoPanel } from '@/components/memo/memo-panel';
import { formatBytes } from '@/lib/utils';

type Step = 'verify' | 'documents' | 'assist' | 'compare' | 'scoring' | 'verify-score' | 'report';
const STEPS: { key: Step; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { key: 'verify', label: '身份核验', Icon: ShieldCheck },
  { key: 'documents', label: '标书获取', Icon: FileText },
  { key: 'assist', label: '辅助评标', Icon: Sparkles },
  { key: 'compare', label: '条款响应核对', Icon: Scale },
  { key: 'scoring', label: '专家打分', Icon: Edit3 },
  { key: 'verify-score', label: '核对', Icon: CheckCircle },
  { key: 'report', label: '评审报告', Icon: BarChart3 },
];

// CATEGORY_LABEL, CATEGORY_COLOR 从 @water-erp/shared 导入（单一来源）

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
  const [clarDrafting, setClarDrafting] = useState(false);
  // P3: real-time status board
  const [liveEvents, setLiveEvents] = useState<{ time: number; label: string; icon: 'decrypt' | 'stage' | 'signin' | 'avoid' | 'score' | 'report' | 'clarify' }[]>([]);
  const [aggregatePresence, setAggregatePresence] = useState<any>(null);
  // P5 Task 7: 桌面端备忘抽屉（scoring / verify-score 步骤可开启；键盘输入为主，可查看平板墨迹）
  const [memoOpen, setMemoOpen] = useState(false);

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
    onBidValidityChange: (d) => {
      // invalid→置灰锁定打分；revoked→恢复可打分（决策 B：接受跳变，每票重判）
      setInvalidSupplierIds(prev => {
        const next = new Set(prev);
        if (d.status === 'invalid') next.add(d.supplierId);
        else next.delete(d.supplierId);
        return next;
      });
      const supplierName = project?.suppliers.find(s => s.id === d.supplierId)?.supplierName ?? d.supplierId;
      pushLiveEvent(
        `${supplierName} ${d.status === 'invalid' ? '被废标' : '废标已撤销'}（${d.failCount}/${d.totalCount}）`,
        'stage',
      );
    },
  });

  const [documents, setDocuments] = useState<Record<string, DecryptedDocuments | null>>({});
  const [assistData, setAssistData] = useState<AssistData | null>(null);
  const [assistLoading, setAssistLoading] = useState(false);
  // P0-1: scores keyed by `${supplierId}:${scoreItemId}` (composite) — never flat by scoreItemId.
  // Task 7: `points` 子记录按 pointId 存 checklist 决策（checked + awardedScore）；onChange 时 Σ→score rollup。
  const [scores, setScores] = useState<Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>>({});
  const [report, setReport] = useState<EvaluationReport | null>(null);

  const [confidentialityAgreed, setConfidentialityAgreed] = useState(false);
  const [disciplineAgreed, setDisciplineAgreed] = useState(false);
  // P2: per-supplier conflict declaration
  const [conflictedSupplierIds, setConflictedSupplierIds] = useState<Set<string>>(new Set());
  // Phase ④ Task 7: backend `bid:validity:change` invalid/revoked → real-time grey-out
  const [invalidSupplierIds, setInvalidSupplierIds] = useState<Set<string>>(new Set());
  const [avoiding, setAvoiding] = useState(false);
  // ④ AI 辅助评标声明：勾选门控（确认态以服务端 expert.aiConsentConfirmed 为准）
  const [aiConsentChecked, setAiConsentChecked] = useState(false);

  // P2: step gating — each step is unlocked only when its preconditions are met
  // Task 6: verify-score completion — all active (decrypted, non-withdrawn) suppliers verified
  const allScoreReviewsVerified = (): boolean => {
    if (!project) return false;
    const reviews = (expert as any)?.scoreReviews as
      | { supplierId: string; status: string }[]
      | undefined;
    if (!reviews) return false;
    const activeSuppliers = project.suppliers.filter(
      (s) => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回',
    );
    if (activeSuppliers.length === 0) return false;
    return activeSuppliers.every(
      (s) =>
        reviews.find((r) => r.supplierId === s.id)?.status === 'verified',
    );
  };
  const stepAccessible = (sKey: Step): boolean => {
    switch (sKey) {
      case 'verify': return true;
      case 'documents': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'assist': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'compare': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'scoring': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'verify-score': return (expert?.progress ?? 0) >= 100;
      case 'report': return !!expert?.reportConfirmed || (expert?.progress ?? 0) >= 100;
    }
  };
  const stepCompleted = (sKey: Step): boolean => {
    switch (sKey) {
      case 'verify': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed && confidentialityAgreed && disciplineAgreed;
      case 'documents': return false; // no "complete" state for browsing docs
      case 'assist': return false;
      case 'compare': return false;
      case 'scoring': return !!expert?.reportConfirmed;
      case 'verify-score': return allScoreReviewsVerified();
      case 'report': return !!expert?.reportConfirmed;
    }
  };

  // P0-2: reason validation — set of scoreItemIds whose reason is missing on submit attempt.
  const [missingReasons, setMissingReasons] = useState<Set<string>>(new Set());
  // Fix 1: dispute-categories 改 per-supplier —— disputeCategoriesBySupplier 按 supplierId 分组，
  // confirmedDispute 是 per-supplier UI 核对态（切供应商时重置）。无异议的供应商自然不 gate。
  const [disputeCategoriesBySupplier, setDisputeCategoriesBySupplier] = useState<Record<string, string[]>>({});
  // Task 4: 异议备注（per-supplier+category）— 列表用于打分 step「📎插入异议」联动
  const [disputesBySupplier, setDisputesBySupplier] = useState<Record<string, Record<string, Array<{ requirementId: string; content: string; note: string; verdict: 'dispute' | 'doubt' }>>>>({});
  // Task 5: 复选框面板开关 key（聚焦理由框 / 点📎按钮均开同一面板）
  const [reviewPanelOpenKey, setReviewPanelOpenKey] = useState<string | null>(null);
  // Task 5: 已插入的 note id 集合（`${supplierId}:${requirementId}`），实现幂等
  const [insertedKeys, setInsertedKeys] = useState<Set<string>>(new Set());
  // Task 5: 点击面板内部时抑制 blur 关闭
  const suppressBlurRef = useRef(false);
  const [confirmedDispute, setConfirmedDispute] = useState<Record<string, boolean>>({});
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
        // M-2: hydrate invalid supplier IDs from server data so grey-out survives page refresh.
        setInvalidSupplierIds(new Set((p.suppliers || []).filter(s => (s as any).bidValidity === 'invalid').map(s => s.id)));
        // P0-1: hydrate with composite keys so each supplier's scores are isolated.
        const existing: Record<string, { score: number; reason: string }> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = { score: Number(rec.score), reason: rec.reason || '' };
        });
        setScores(existing);
        // P2: sync per-supplier conflicts from server
        const serverConflicts: string[] = p.myExpertRecord?.conflictedSupplierIds || [];
        if (serverConflicts.length > 0) setConflictedSupplierIds(new Set(serverConflicts));
        // Fix 1: fetch disputeCategoriesBySupplier (per-supplier) via my-scores endpoint.
        // Task 4: 同时取 disputesBySupplier（异议详情，用于打分 step「📎插入异议」联动）。
        // Task 7: 同时取 pointDecisions，按 pointId→scoreItemId 映射 hydrate 到 scores[k].points。
        api.get<{
          records: unknown[];
          disputeCategoriesBySupplier: Record<string, string[]>;
          disputesBySupplier: Record<string, Record<string, Array<{ requirementId: string; content: string; note: string; verdict: 'dispute' | 'doubt' }>>>;
          pointDecisions?: Array<{ pointId: string; supplierId: string; checked: boolean; awardedScore: number | string; note?: string }>;
        }>(`/expert/projects/${projectId}/my-scores`)
          .then((d) => {
            setDisputeCategoriesBySupplier(d.disputeCategoriesBySupplier ?? {});
            setDisputesBySupplier(d.disputesBySupplier ?? {});
            // Task 7: hydrate point decisions —— build pointId→scoreItemId map once from project.scoreItems.
            const pointToItem = new Map<string, string>();
            for (const si of p.scoreItems ?? []) {
              for (const pt of si.points ?? []) pointToItem.set(pt.id, si.id);
            }
            setScores(prev => {
              const next = { ...prev };
              for (const pd of (d.pointDecisions ?? [])) {
                const scoreItemId = pointToItem.get(pd.pointId);
                if (!scoreItemId) continue;
                const k = scoreKey(pd.supplierId, scoreItemId);
                const cur = next[k] ?? { score: 0, reason: '' };
                next[k] = {
                  ...cur,
                  points: { ...(cur.points ?? {}), [pd.pointId]: { checked: pd.checked, awardedScore: Number(pd.awardedScore) } },
                };
              }
              return next;
            });
          })
          .catch(() => { /* my-scores optional — ignore */ });
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
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt: number };
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
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt: number };
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

  // Guard: redirect to verify if current step is not accessible
  useEffect(() => {
    if (!project) return;
    if (!stepAccessible(step)) {
      setStep('verify');
    }
  }, [step, expert?.signedIn, expert?.avoidanceConfirmed, expert?.aiConsentConfirmed, expert?.reportConfirmed, expert?.progress, confidentialityAgreed, disciplineAgreed]);

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
      const msg = e instanceof ApiError && e.data?.error ? String(e.data.error) : e.message || '发送失败';
      toast.error(msg);
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
      const data = e instanceof ApiError ? e.data : null;
      setCodeError(data?.error ? String(data.error) : e.message || '验证失败');
      autoVerifyRef.current = false; // disable auto-verify after first failure
      if (data?.code === 'ATTEMPTS_EXCEEDED' || data?.code === 'CODE_EXPIRED') {
        setCodeSent(false);
        setVerificationCode('');
      }
      const match = data?.error ? String(data.error).match(/剩余 (\d+) 次/) : null;
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

  const handleConfirmAiConsent = async () => {
    if (!aiConsentChecked) return;
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/ai-consent`, {});
      loadProject();
      toast.success('AI 辅助评标声明已确认');
    } catch (e: any) {
      toast.error(e.message || '确认失败');
    }
    setBusy(false);
  };

  const loadDocuments = async (sid: string, sharedSeq?: number) => {
    const seq = sharedSeq ?? ++docSeqRef.current;
    try {
      const data = await api.get<DecryptedDocuments>(`/expert/projects/${projectId}/documents/${sid}`);
      if (seq === docSeqRef.current || sharedSeq !== undefined) setDocuments(prev => ({ ...prev, [sid]: data }));
    }
    catch (e: any) { if (seq === docSeqRef.current || sharedSeq !== undefined) toast.error(e.message || '加载标书失败'); }
  };

  const loadAllDocuments = async () => {
    if (!project) return;
    const batchSeq = ++docSeqRef.current;
    setDocuments({});
    await Promise.all(project.suppliers.map(s => loadDocuments(s.id, batchSeq)));
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

  // P1-F：AI 起草澄清候选（不落库，填入 textarea，专家改完再发）
  const draftClarificationQ = async () => {
    if (!projectId) return;
    if (!clarSupplierId) { toast.error('请先选择供应商'); return; }
    setClarDrafting(true);
    try {
      const res: any = await api.post(`/expert/projects/${projectId}/clarifications/draft`, { supplierId: clarSupplierId });
      const drafts: string[] = res?.drafts ?? res?.data?.drafts ?? [];
      if (drafts.length) {
        setClarQuestion(drafts[0]);
        toast.success(`AI 已起草 ${drafts.length} 条候选，已填入第一条，请审阅修改`);
      } else {
        toast.info('AI 暂无起草建议（该供应商可能无 AI 分析弱点）');
      }
    } catch (e: any) {
      toast.error(e.message || 'AI 起草失败');
    } finally {
      setClarDrafting(false);
    }
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
    if (step === 'documents' && project) loadAllDocuments();
    if ((step === 'assist' || step === 'compare') && activeSupplier) loadAssist(activeSupplier);
  }, [step, activeSupplier, project]);

  const handleSubmitScores = async () => {
    if (!project || !activeSupplier) return;
    if (expert?.reportConfirmed) { toast.warning('评审报告已确认，评分已锁定'); return; }
    const activeSupplierRecord = project.suppliers.find(s => s.id === activeSupplier);
    const supplierName = activeSupplierRecord?.supplierName || '';
    const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回'
    // P2: also block if expert declared conflict with this supplier
    && !conflictedSupplierIds.has(activeSupplier)
    && !(project?.myExpertRecord?.conflictedSupplierIds || []).includes(activeSupplier)
    // Phase ④ Task 7: block if supplier is currently 废标 (invalid)
    && !invalidSupplierIds.has(activeSupplier);
    if (!canScoreActiveSupplier) {
      toast.warning('该投标单位未解密成功、已撤回或已废标，不能评分');
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
    // Fix 1: dispute-categories 软拦截 — 仅作用于当前 activeSupplier 的异议类别；无异议供应商不 gate。
    // 不改分、不阻断报告确认。
    const activeDisputes = new Set(disputeCategoriesBySupplier[activeSupplier] ?? []);
    const unconfirmed = [...activeDisputes].filter((c) => !confirmedDispute[c]);
    if (unconfirmed.length > 0) {
      toast.warning(`以下类别有异议条款未核对：${unconfirmed.map((c) => CATEGORY_LABEL[c] || c).join('、')}`);
      return;
    }
    const scoresPayload = project.scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      const hasPoints = (si.points ?? []).length > 0;
      if (isPassFailCategory(si.category)) {
        return { scoreItemId: si.id, supplierId: activeSupplier, passed: entry?.passed, reason: entry?.reason ?? '' };
      }
      if (hasPoints) {
        // Task 7: checklist 模式 —— 附 pointDecisions，后端据其核定 score。
        return {
          scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '',
          pointDecisions: Object.entries(entry?.points ?? {}).map(([pointId, d]) => ({ pointId, checked: d.checked, awardedScore: d.awardedScore })),
        };
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
  const activeSupplierRecord = project.suppliers.find(s => s.id === activeSupplier);
  const canScoreActiveSupplier = activeSupplierRecord?.decryptStatus === 'SUCCESS' && activeSupplierRecord?.submitStatus !== '已撤回'
    // P2: also block if expert declared conflict with this supplier
    && !conflictedSupplierIds.has(activeSupplier)
    && !(project?.myExpertRecord?.conflictedSupplierIds || []).includes(activeSupplier)
    // Phase ④ Task 7: block if supplier is currently 废标 (invalid)
    && !invalidSupplierIds.has(activeSupplier);
  const scoreLocked = !!expert?.reportConfirmed;

  // ── Task 5: 聚焦复选框面板 helpers ──
  const noteId = (supplierId: string, requirementId: string) => `${supplierId}:${requirementId}`;

  const buildInsertText = (dsp: { requirementId: string; content: string; note: string }) => {
    const clause = dsp.content?.trim() ? dsp.content.slice(0, 40) : '(原文缺失)';
    const body = dsp.note?.trim()
      ? dsp.note
      : dsp.content?.trim() ? dsp.content : '(原文缺失)';
    return `【★条款：${clause}】${body}`;
  };

  const onToggleNote = (
    k: string,
    supplierId: string,
    dsp: { requirementId: string; content: string; note: string },
    itemId: string,
  ) => {
    const id = noteId(supplierId, dsp.requirementId);
    if (insertedKeys.has(id)) return; // 幂等：已插入不再插；取消勾选不动文字
    const text = buildInsertText(dsp);
    setScores(prev => {
      const cur = prev[k];
      const prevReason = cur?.reason ?? '';
      const newReason = prevReason
        ? (prevReason.endsWith('\n') ? prevReason + text : prevReason + '\n' + text)
        : text;
      return { ...prev, [k]: { score: cur?.score ?? 0, reason: newReason, passed: cur?.passed } };
    });
    setInsertedKeys(prev => { const n = new Set(prev); n.add(id); return n; });
    if (missingReasons.has(itemId)) setMissingReasons(prev => { const n = new Set(prev); n.delete(itemId); return n; });
  };

  const onReasonFocus = (k: string) => setReviewPanelOpenKey(k);
  const onReasonBlur = () => {
    setTimeout(() => {
      if (!suppressBlurRef.current) setReviewPanelOpenKey(null);
      suppressBlurRef.current = false;
    }, 0);
  };

  // Task 5: 复选框面板渲染（聚焦理由框 / 点📎按钮共用）
  const renderReviewPanel = (
    k: string,
    category: string,
    itemId: string,
  ) => {
    const notes = disputesBySupplier[activeSupplier]?.[category] ?? [];
    if (notes.length === 0 || scoreLocked) return null;
    const open = reviewPanelOpenKey === k;
    return (
      <div className="mt-1.5">
        <button type="button"
          onClick={() => setReviewPanelOpenKey(prev => (prev === k ? null : k))}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:bg-amber-50 px-2 py-1 rounded-md transition">
          <AlertTriangle size={11} strokeWidth={1.5} /> {open ? '收起' : '插入异议/疑问'}
        </button>
        {open && (
          <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2 space-y-1.5">
            {notes.map((dsp, idx) => {
              const id = noteId(activeSupplier, dsp.requirementId);
              const inserted = insertedKeys.has(id);
              return (
                <label key={`rev-${dsp.requirementId}-${idx}`}
                  onMouseDown={() => { suppressBlurRef.current = true; }}
                  className={`flex items-start gap-2 text-xs rounded px-2 py-1 ${inserted ? 'opacity-60' : 'hover:bg-white/70'}`}>
                  <input type="checkbox" checked={inserted} disabled={inserted}
                    onChange={() => onToggleNote(k, activeSupplier, dsp, itemId)}
                    className="mt-0.5 accent-amber-600" />
                  <div className="flex-1 min-w-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-1 ${dsp.verdict === 'dispute' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {dsp.verdict === 'dispute' ? '异议' : '疑问'}
                    </span>
                    <span className="font-semibold text-amber-900">{dsp.content?.slice(0, 40) || '(原文缺失)'}</span>
                    {dsp.note && <div className="text-amber-700 mt-0.5">{dsp.note}</div>}
                    {inserted && <div className="text-[10px] text-amber-600 mt-0.5">已插入</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* P3: disconnected banner */}
      {_wsConn !== 'connected' && (
        <div className={`mb-3 px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between flex-shrink-0 ${
          _wsConn === 'reconnecting' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} strokeWidth={1.5} />{_wsConn === 'reconnecting' ? '实时连接中断，正在重连…' : '实时连接已断开，数据可能不是最新'}</span>
          <button onClick={_wsReconnect} className="underline hover:no-underline">重试</button>
        </div>
      )}

      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/projects')} className="inline-flex items-center gap-1 text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] transition"><ArrowLeft size={14} strokeWidth={1.5} /> 返回</button>
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowClarifications(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl min-h-[50vh] max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]"><MessageSquare size={14} strokeWidth={1.5} className="inline mr-1" />澄清与答疑</h3>
            <button onClick={() => setShowClarifications(false)} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)]"><X size={14} strokeWidth={1.5} /></button>
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
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className="flex justify-end mb-1">
                  <button type="button" onClick={draftClarificationQ} disabled={clarDrafting || !clarSupplierId}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#064ea2] hover:underline disabled:opacity-40">
                    <Sparkles size={11} /> {clarDrafting ? '起草中…' : 'AI 起草'}
                  </button>
                </div>
                <textarea value={clarQuestion} onChange={e => setClarQuestion(e.target.value)}
                  placeholder="向所选供应商发起澄清…（Ctrl+Enter 发送）"
                  rows={4}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postClarification(); } }}
                  className="w-full border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-1.5 text-xs bg-white/60 focus:outline-none focus:border-[#064ea2] resize-y min-h-[96px]" />
              </div>
              <button onClick={postClarification} disabled={clarPosting}
                className="px-3 py-1.5 bg-[#064ea2] text-white text-xs font-bold rounded-lg hover:bg-[#054280] transition disabled:opacity-50">
                {clarPosting ? '…' : '发送'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* 步骤指示器 — 独立、干净，不与供应商选择混合 */}
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-center gap-1 px-1">
          {STEPS.map((s, i) => {
            const accessible = stepAccessible(s.key);
            const completed = stepCompleted(s.key);
            const isCurrent = step === s.key;
            return (
              <div key={s.key} className="flex items-center">
                <button
                  onClick={() => { if (accessible) setStep(s.key); }}
                  disabled={!accessible}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all text-xs font-semibold whitespace-nowrap ${
                    isCurrent
                      ? 'bg-[#064ea2] text-white shadow-sm'
                      : completed
                        ? 'text-[#11a874]'
                        : accessible
                          ? 'text-[oklch(0.48_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
                          : 'text-[oklch(0.65_0.008_264)] cursor-not-allowed'
                  }`}
                >
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                    isCurrent
                      ? 'bg-white/20 text-white'
                      : completed
                        ? 'bg-emerald-100 text-[#11a874]'
                        : accessible
                          ? 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.48_0.01_264)]'
                          : 'bg-[oklch(0.96_0.004_264)] text-[oklch(0.65_0.008_264)]'
                  }`}>
                    {completed ? <CheckCircle size={10} strokeWidth={2} /> : i + 1}
                  </span>
                  <s.Icon size={13} strokeWidth={1.5} />
                  {s.label}
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-5 h-px mx-0.5 ${completed ? 'bg-[#11a874]/30' : 'bg-[oklch(0.91_0.006_264)]'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 主内容区：供应商侧边栏 + 内容 */}
      <div className="flex-1 flex overflow-hidden min-h-0 rounded-xl border border-[oklch(0.91_0.006_264)] bg-white/60">
        {/* 供应商侧边栏 — 辅助评标 / 条款响应核对 / 专家打分步骤显示 */}
        {(step === 'assist' || step === 'compare' || step === 'scoring' || step === 'verify-score') && (
          <SupplierSidebar
            suppliers={project.suppliers}
            activeSupplier={activeSupplier}
            onSelect={(id) => { setActiveSupplier(id); setMissingReasons(new Set()); setConfirmedDispute({}); setReviewPanelOpenKey(null); }}
            conflictedSupplierIds={conflictedSupplierIds}
            invalidSupplierIds={invalidSupplierIds}
            decryptLabel={DECRYPT_LABEL}
            scoringProgress={
              step === 'scoring'
                ? Object.fromEntries(
                    project.suppliers.map((s) => {
                      const supplierScoreItems = project.scoreItems.filter(
                        () => true
                      );
                      const scored = project.scoreItems.filter(
                        (si) => {
                          const k = scoreKey(s.id, si.id);
                          const entry = scores[k];
                          if (isPassFailCategory(si.category)) {
                            return typeof entry?.passed === 'boolean';
                          }
                          return (entry?.score ?? 0) > 0 || (entry?.reason || '').trim().length > 0;
                        }
                      ).length;
                      return [s.id, { scored, total: project.scoreItems.length }];
                    })
                  )
                : undefined
            }
          />
        )}

        {/* 内容面板 */}
        <div className="flex-1 overflow-hidden min-h-0">
          <div className="h-full overflow-y-auto">
          {/* ====== 身份核验 ====== */}
          {step === 'verify' && (
            <div className="p-6 max-w-3xl mx-auto">
              <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)] mb-6">身份核验与承诺确认</h2>

              <div className="space-y-4 mb-6">
                {/* ===== ① 身份核验 — 始终可用 ===== */}
                <div>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${expert?.signedIn ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[oklch(0.91_0.006_264)]'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${expert?.signedIn ? 'bg-emerald-500 text-white' : 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'}`}>
                      {expert?.signedIn ? <Check size={18} strokeWidth={2.5} /> : '1'}
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
                          <CheckCircle size={20} strokeWidth={1.5} className="text-emerald-500" />
                          <div>
                            <p className="text-sm font-semibold text-emerald-600">手机验证通过</p>
                            <p className="text-xs text-emerald-500">{phoneMasked}</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1 flex items-center gap-1.5"><Phone size={14} strokeWidth={1.5} className="text-[#064ea2]" />手机验证</p>
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
                      {confidentialityAgreed ? <Check size={18} strokeWidth={2.5} /> : expert?.signedIn ? '2' : <Lock size={16} strokeWidth={1.5} />}
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
                      {disciplineAgreed ? <Check size={18} strokeWidth={2.5} /> : confidentialityAgreed ? '3' : <Lock size={16} strokeWidth={1.5} />}
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

                {/* ===== ④ AI 辅助评标声明 — 评标纪律确认后解锁 ===== */}
                <div className={!disciplineAgreed ? 'opacity-50 pointer-events-none select-none' : ''}>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    expert?.aiConsentConfirmed ? 'bg-emerald-50 border-emerald-200'
                    : disciplineAgreed ? 'bg-white/70 border-[oklch(0.91_0.006_264)]'
                    : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      expert?.aiConsentConfirmed ? 'bg-emerald-500 text-white'
                      : disciplineAgreed ? 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'
                      : 'bg-gray-200 text-gray-400'
                    }`}>
                      {expert?.aiConsentConfirmed ? <Check size={18} strokeWidth={2.5} /> : disciplineAgreed ? '4' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        expert?.aiConsentConfirmed ? 'text-emerald-600'
                        : disciplineAgreed ? 'text-[oklch(0.18_0.012_265)]'
                        : 'text-gray-400'
                      }`}>AI 辅助评标声明</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">确认 AI 辅助结果仅供参考</p>
                    </div>
                    {!disciplineAgreed && (
                      <span className="text-xs text-[oklch(0.72_0.008_264)] bg-[oklch(0.96_0.004_264)] px-2 py-1 rounded font-semibold">需先确认评标纪律</span>
                    )}
                    {disciplineAgreed && !expert?.aiConsentConfirmed && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-semibold">待签署</span>
                    )}
                  </div>
                  {/* AI 声明书 — 解锁后且未确认时显示 */}
                  {disciplineAgreed && !expert?.aiConsentConfirmed && (
                    <div className="mt-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 flex items-center gap-2">
                        <Sparkles size={14} strokeWidth={1.5} /> AI 辅助评标使用声明
                      </h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)] leading-relaxed mb-3">
                        本项目评审引入人工智能（大语言模型与文档识别）辅助工具，可对投标文件进行合规性检查、风险提示与评分参考分析。本人郑重声明并知悉：
                      </p>
                      <div className="space-y-2 text-sm text-[oklch(0.55_0.01_264)] mb-4">
                        <p>一、AI 辅助工具生成的合规判断、风险提示、评分建议等内容，性质均为<strong className="text-[oklch(0.18_0.012_265)]">辅助参考</strong>，不构成评审结论；</p>
                        <p>二、上述 AI 意见仅供本人在评标过程中参考，<strong className="text-[oklch(0.18_0.012_265)]">不得干预或干扰本人的独立职业判断</strong>；</p>
                        <p>三、任何 AI 输出均<strong className="text-[oklch(0.18_0.012_265)]">不得作为本人打分的直接依据或唯一理由</strong>，本人对每一项评分及其理由独立负责；</p>
                        <p>四、最终评审意见与评分结果，由本人依据招标文件规定的标准和方法、结合专业判断独立作出，不由 AI 决定，亦不因 AI 意见而免除本人的评审责任。</p>
                      </div>
                      <p className="text-sm text-[oklch(0.55_0.01_264)] mb-4 font-medium">本人确认已阅读并充分理解上述声明。</p>
                      <label className="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox" checked={aiConsentChecked} onChange={e => setAiConsentChecked(e.target.checked)}
                          className="w-4 h-4 rounded border-blue-200 text-[#064ea2] focus:ring-[#064ea2]" />
                        <span className="text-sm text-[oklch(0.18_0.012_265)] font-semibold">本人已阅读并知悉以上声明</span>
                      </label>
                      <button onClick={handleConfirmAiConsent} disabled={!aiConsentChecked || busy}
                        className="px-5 py-2 bg-[#064ea2] text-white rounded-lg font-bold text-sm hover:bg-[#054280] transition disabled:opacity-50">
                        {busy ? '确认中…' : '确认同意'}
                      </button>
                    </div>
                  )}
                  {/* 已确认条 */}
                  {disciplineAgreed && expert?.aiConsentConfirmed && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="text-emerald-500" />
                      <span className="text-sm text-emerald-600 font-semibold">已确认 AI 辅助评标声明</span>
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

              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && expert?.aiConsentConfirmed && (
                <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-3">
                  <CheckCircle size={20} strokeWidth={1.5} className="text-emerald-500" />
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
            <DocumentsStep project={project} documents={documents} />
          )}

          {/* ====== 辅助评标（AI引擎驱动） ====== */}
          {step === 'assist' && (
            <div>
              <AssistPanel
                assistData={assistData}
                assistLoading={assistLoading}
                activeSupplier={activeSupplier}
                supplierName={project.suppliers.find(s => s.id === activeSupplier)?.supplierName || '请选择'}
                decryptStatus={project.suppliers.find(s => s.id === activeSupplier)?.decryptStatus ?? ''}
                expertScores={scores}
                projectScoreItems={project.scoreItems}
                projectId={projectId}
                onRetry={() => activeSupplier && loadAssist(activeSupplier)}
              />
            </div>
          )}

          {/* ====== 条款响应核对 ====== */}
          {step === 'compare' && (
            <div className="p-6">
              <RequirementComparePanel
                key={activeSupplier}
                projectId={projectId}
                supplierId={activeSupplier}
                requirements={assistData?.requirements}
                responses={assistData?.requirementResponses ?? []}
                reviews={assistData?.reviews ?? []}
                tenderDocUrl={project?.tenderDocument?.downloadUrl}
              />
            </div>
          )}

          {/* ====== 专家打分 ====== */}
          {step === 'scoring' && (
            <div className="p-6">
              <div className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">专家独立打分</h2>
                  <p className="text-sm text-[oklch(0.55_0.01_264)] mt-0.5">请根据您的专业判断进行客观评分</p>
                </div>
                {/* P5 Task 7: 桌面端备忘入口（键盘输入 + 查看平板墨迹） */}
                <button
                  type="button"
                  onClick={() => setMemoOpen(true)}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white px-3 py-2 text-xs font-bold text-[oklch(0.4_0.012_265)] transition hover:bg-[oklch(0.97_0.005_264)]"
                  aria-label="打开备忘面板"
                >
                  <StickyNote size={14} strokeWidth={1.7} /> 备忘
                </button>
              </div>

              {/* P0-3: draft recovery banner */}
              {draftAvailable && !draftDismissed && (
                <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-center gap-3">
                  <ClipboardList size={20} strokeWidth={1.5} className="text-amber-500" />
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
                      // Fix 1: 按当前 activeSupplier 过滤异议类别。
                      const activeDisputes = new Set(disputeCategoriesBySupplier[activeSupplier] ?? []);
                      const disputed = activeDisputes.has(category);
                      return (
                        <div key={category} className={`bg-blue-50 rounded-xl border overflow-hidden ${disputed ? 'border-amber-300 ring-1 ring-amber-200' : 'border-blue-100'}`}>
                          <div className="flex items-center justify-between p-4 border-b border-blue-100" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[category] || '#064ea2'}` }}>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ color: CATEGORY_COLOR[category] || '#064ea2', backgroundColor: (CATEGORY_COLOR[category] || '#064ea2') + '18' }}>
                                {CATEGORY_LABEL[category] || category}
                              </span>
                              <span className="text-sm text-[oklch(0.55_0.01_264)]">{items.length} 项</span>
                              {disputed && <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">⚠ 有异议条款待核对</span>}
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
                            {/* Task 4: 异议备注区 — disputed category 顶部列出异议条款摘要 + note，供专家打分参考 */}
                            {disputed && (disputesBySupplier[activeSupplier]?.[category]?.filter((d) => d.verdict === 'dispute').length ?? 0) > 0 && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                                <div className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                                  <AlertTriangle size={12} strokeWidth={1.5} /> 异议备注（{disputesBySupplier[activeSupplier][category].filter((d) => d.verdict === 'dispute').length} 条 · 聚焦下方理由框可勾选复选框引用）
                                </div>
                                <ul className="space-y-1.5">
                                  {disputesBySupplier[activeSupplier][category].filter((d) => d.verdict === 'dispute').map((dsp, idx) => (
                                    <li key={`${dsp.requirementId}-${idx}`} className="text-xs text-amber-900 bg-white/70 rounded px-2 py-1.5 border border-amber-100">
                                      <div className="font-semibold truncate" title={dsp.content}>条款：{dsp.content}</div>
                                      {dsp.note && <div className="text-amber-700 mt-0.5">异议：{dsp.note}</div>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {items.map((item, idx) => {
                              const k = scoreKey(activeSupplier, item.id);
                              const val = scores[k];
                              const reasonMissing = missingReasons.has(item.id);
                              const passFail = isPassFailCategory(item.category);
                              const isLastItem = idx === items.length - 1;
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
                                        onFocus={() => onReasonFocus(k)}
                                        onBlur={onReasonBlur}
                                        onChange={e => {
                                          const v = e.target.value;
                                          setScores(prev => ({ ...prev, [k]: { score: 0, reason: v, passed: false } }));
                                          if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                        }}
                                        className={`w-full rounded-lg px-3 py-2 text-sm text-[oklch(0.18_0.012_265)] resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                        aria-label={`${item.name} 不通过理由`} />
                                    )}
                                    {/* Task 5: pass-fail 「不通过」理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                    {verdict === false && renderReviewPanel(k, category, item.id)}
                                    {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold flex items-center gap-1"><AlertTriangle size={12} strokeWidth={1.5} />请选择「通过 / 不通过」，不通过需填理由</p>}
                                  </div>
                                );
                              }
                              // 数值项：有 points 用 checklist；无 points 用旧滑块（向后兼容）
                              const currentScore = val?.score ?? 0;
                              const max = Number(item.maxScore);
                              const pct = max > 0 ? (currentScore / max) * 100 : 0;
                              const itemPoints = (item.points ?? []).map(p => ({ id: p.id, name: p.name, fullScore: p.fullScore, objective: p.objective, evidenceHint: p.evidenceHint, seq: p.seq }));
                              if (itemPoints.length > 0) {
                                return (
                                  <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                      <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                                    </div>
                                    <PointChecklistScoring
                                      points={itemPoints}
                                      value={val?.points ?? {}}
                                      onChange={(pid, pv) => setScores(prev => {
                                        const cur = prev[k] ?? { score: 0, reason: '' };
                                        const points = { ...(cur.points ?? {}), [pid]: pv };
                                        // rollup: Σ awardedScore → item.score（类别小计 + submit payload 都读 score）
                                        const score = itemPoints.reduce((s, p) => s + (points[p.id]?.awardedScore ?? 0), 0);
                                        return { ...prev, [k]: { ...cur, points, score, reason: cur.reason ?? '', passed: cur.passed } };
                                      })} />
                                    <textarea placeholder="评分理由（可选）" value={val?.reason || ''}
                                      onFocus={() => onReasonFocus(k)}
                                      onBlur={onReasonBlur}
                                      onChange={e => {
                                        const v = e.target.value;
                                        setScores(prev => {
                                          const cur = prev[k] ?? { score: 0, reason: '' };
                                          return { ...prev, [k]: { ...cur, score: cur.score ?? 0, reason: v, points: cur.points, passed: cur.passed } };
                                        });
                                        if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                      }}
                                      onKeyDown={e => handleScoringKeyDown(e, isLastItem)}
                                      className={`w-full rounded-lg px-3 py-2 text-sm resize-none h-16 mt-3 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                      aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                    {/* Task 5: 数值项理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                    {renderReviewPanel(k, category, item.id)}
                                    {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold flex items-center gap-1"><AlertTriangle size={12} strokeWidth={1.5} />该项得分低于满分，请填写评分理由</p>}
                                  </div>
                                );
                              }
                              // 无 points → 旧滑块（保留现有渲染不变）
                              return (
                                <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                                    <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                                  </div>
                                  <div className="flex items-center gap-4 mb-3">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                                      className="flex-1 h-2 bg-[oklch(0.94_0.004_264)] rounded-full appearance-none cursor-pointer accent-[#064ea2] focus:outline-none focus:ring-2 focus:ring-[#064ea2] focus:ring-offset-2"
                                      style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }}
                                      aria-label={`${item.name} 评分`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={currentScore} aria-valuetext={`${currentScore} / ${max} 分`} tabIndex={0} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[k]?.reason || '' } }))}
                                      onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); const v = Math.min((currentScore || 0) + 0.5, max); setScores(prev => ({ ...prev, [k]: { score: v, reason: prev[k]?.reason || '' } })); } else if (e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max((currentScore || 0) - 0.5, 0); setScores(prev => ({ ...prev, [k]: { score: v, reason: prev[k]?.reason || '' } })); } handleScoringKeyDown(e, isLastItem); }}
                                      className="w-20 text-center border border-blue-100 rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2] outline-none"
                                      aria-label={`${item.name} 数值输入`} tabIndex={0} />
                                  </div>
                                  <textarea placeholder="评分理由（低于满分必填）" value={val?.reason || ''}
                                    onFocus={() => onReasonFocus(k)}
                                    onBlur={onReasonBlur}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setScores(prev => ({ ...prev, [k]: { score: prev[k]?.score ?? 0, reason: v } }));
                                      if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                    }}
                                    onKeyDown={e => handleScoringKeyDown(e, isLastItem)}
                                    className={`w-full rounded-lg px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-blue-100 focus:ring-[#064ea2]'}`}
                                    aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                  {/* Task 5: 数值项理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                  {renderReviewPanel(k, category, item.id)}
                                  {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold flex items-center gap-1"><AlertTriangle size={12} strokeWidth={1.5} />该项得分低于满分，请填写评分理由</p>}
                                </div>
                              );
                            })}
                          </div>
                          {disputed && (
                            <label className="flex items-center gap-2 px-4 py-2 bg-amber-50/60 border-t border-amber-200 text-xs text-amber-800 cursor-pointer">
                              <input
                                type="checkbox"
                                className="accent-amber-600"
                                checked={!!confirmedDispute[category]}
                                onChange={(e) => setConfirmedDispute({ ...confirmedDispute, [category]: e.target.checked })}
                              />
                              已核对本类异议条款
                            </label>
                          )}
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



          {/* ====== 核对评分（verify-score）— 只读审阅 + 确认核对 ====== */}
          {step === 'verify-score' && project && activeSupplier && (
            <VerifyScoreStep
              projectId={projectId}
              supplierId={activeSupplier}
              supplierName={project.suppliers.find((s) => s.id === activeSupplier)?.supplierName || ''}
              scoreItems={project.scoreItems}
              scores={scores}
              reviewStatus={
                (expert as any)?.scoreReviews?.find(
                  (r: { supplierId: string; status: string }) => r.supplierId === activeSupplier,
                )?.status as 'draft' | 'verified' | undefined
              }
              onVerified={loadProject}
              onOpenMemo={() => setMemoOpen(true)}
            />
          )}

          {/* ====== 评审报告 ====== */}
          {step === 'report' && (
            <ReportStep report={report} busy={busy} onConfirmReport={handleConfirmReport} />
          )}
            </div>
          </div>
        </div>

        {/* ====== P5 Task 7: 桌面端备忘抽屉（scoring / verify-score 可开启；键盘输入 + 查看平板墨迹）====== */}
        {memoOpen && (step === 'scoring' || step === 'verify-score') && (
          <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="专家备忘面板">
            {/* 点击遮罩关闭 */}
            <button
              type="button"
              aria-label="关闭备忘面板"
              className="absolute inset-0 bg-black/20"
              onClick={() => setMemoOpen(false)}
            />
            <aside className="relative z-10 flex h-full w-[400px] max-w-[90vw] flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-[oklch(0.91_0.006_264)] px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-[oklch(0.18_0.012_265)]">
                  <StickyNote size={14} strokeWidth={1.7} /> 专家备忘
                  {activeSupplier && (
                    <span className="ml-1 rounded-full bg-[oklch(0.95_0.005_264)] px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.55_0.01_264)]">
                      {project?.suppliers.find(s => s.id === activeSupplier)?.supplierName || '当前供应商'}
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={() => setMemoOpen(false)}
                  aria-label="关闭"
                  className="rounded p-1 text-[oklch(0.55_0.01_264)] transition hover:bg-[oklch(0.96_0.004_264)]"
                >
                  <X size={16} strokeWidth={1.7} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeSupplier ? (
                  <MemoPanel
                    projectId={projectId}
                    supplierId={activeSupplier}
                    sourceDevice="desktop"
                  />
                ) : (
                  <p className="py-6 text-center text-xs text-[oklch(0.62_0.008_264)]">请先在左侧选择供应商</p>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
  );
}
