'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, ApiError, listMemos } from '@/lib/api';
import { toast } from 'sonner';
import { useExpertWebSocket } from '@/hooks/use-expert-websocket';
import { LiveStatusBoard } from '@/components/live-status-board';
import type { ExpertProjectDetail, DecryptedDocuments, AssistData, EvaluationReport } from '@/lib/types';
import { isPassFailCategory, CATEGORY_LABEL, CATEGORY_COLOR, DECRYPT_LABEL } from '@water-erp/shared';
import { validateSupplierScores, type ScoreEntry } from '@/lib/score-validation';
import { ArrowLeft, Check, ShieldCheck, FileText, Sparkles, Edit3, BarChart3, Lock, Unlock, Download, AlertTriangle, CheckCircle, Lightbulb, Key, Clipboard, ClipboardList, Gavel, MessageSquare, X, Scale, StickyNote, History } from 'lucide-react';
import { SigninCamera } from '@/components/signin-camera';
import { AssistPanel } from '@/components/evaluate/assist/assist-panel';
import { RequirementComparePanel } from '@/components/evaluate/assist/requirement-compare-panel';
import { SupplierSidebar } from '@/components/evaluate/supplier-sidebar';
import { DocumentsStep } from '@/components/evaluate/documents-step';
import { ReportStep } from '@/components/evaluate/report-step';
import { VerifyScoreStep } from '@/components/evaluate/verify-score-step';
import { PointChecklistScoring, type PointDecisionValue } from '@/components/evaluate/point-checklist-scoring';
import { MemoPanel } from '@/components/memo/memo-panel';
import { HallMessagePanel } from '@/components/evaluate/hall-message-panel';
import type { HallMessagePayload } from '@water-erp/shared';
import { formatBytes } from '@/lib/utils';
import { SyncConflictModal } from '@/components/evaluate/sync-conflict-modal';
import { ScoreHistoryDrawer } from '@/components/evaluate/score-history-drawer';

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
// ScoreEntry 从 @/lib/score-validation 导入（桌面/平板共用规范定义）

export default function ExpertEvaluatePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ExpertProjectDetail | null>(null);
  const [step, setStep] = useState<Step>('verify');
  const [activeSupplier, setActiveSupplier] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null); // P1-16：加载失败错误态（替代永久 loading）
  const [busy, setBusy] = useState(false);
  // 签到拍照留痕（无摄像头时 photoBlob=null，跳过拍照直接签到）
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceVerifying, setFaceVerifying] = useState(false);
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
  // Task 6: 得分点选中（联动备忘抽屉）—— 桌面允许无选中点的项目/供应商级备忘
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [activePointName, setActivePointName] = useState<string>('');
  const [activeScoreItemId, setActiveScoreItemId] = useState<string | null>(null);
  const [pointMemoCounts, setPointMemoCounts] = useState<Record<string, number>>({});
  const [draftConflicts, setDraftConflicts] = useState<Array<{
    key: string;
    scoreItemName: string;
    localVal: any;
    remoteVal: any;
  }>>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // D1: 开标大厅公聊消息
  const [hallMessages, setHallMessages] = useState<HallMessagePayload[]>([]);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [showMessages, setShowMessages] = useState(false);

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
    // D1: 开标大厅公聊消息
    onHallMessage: (d) => {
      setHallMessages(prev => {
        // 去重（WS 重连可能推送重复消息）
        if (prev.some(m => m.id === d.id)) return prev;
        return [...prev, d].slice(-200); // 最多保留 200 条
      });
      setUnreadMessageCount(prev => prev + 1);
    },
    onScoresSubmitted: (d) => {
      // 忽略自己的提交（避免重复刷新）
      if (project?.myExpertRecord?.id && d.expertId === project.myExpertRecord.id) return;
      loadProject();
    },
    onDraftSaved: (d) => {
      if (d.device === 'desktop') return;
      api.get<{ scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=desktop`)
        .then(draft => {
          if (!draft?.scores) return;
          const newItems: string[] = [];
          const conflicts: typeof draftConflicts = [];
          for (const [key, remoteVal] of Object.entries(draft.scores)) {
            if (!(key in scores)) {
              newItems.push(key);
            } else if (JSON.stringify(scores[key]) !== JSON.stringify(remoteVal)) {
              const itemName = project?.scoreItems.find(si => key.endsWith(`:${si.id}`))?.name ?? key;
              conflicts.push({ key, scoreItemName: itemName, localVal: scores[key], remoteVal });
            }
          }
          if (newItems.length > 0) {
            setScores(prev => {
              const next = { ...prev };
              for (const k of newItems) next[k] = draft.scores![k];
              return next;
            });
          }
          if (conflicts.length > 0) {
            setDraftConflicts(prev => [...prev, ...conflicts]);
          }
        })
        .catch(() => {});
    },
  });

  const [documents, setDocuments] = useState<Record<string, DecryptedDocuments | null>>({});
  const [refreshingDocs, setRefreshingDocs] = useState(false);
  const [assistData, setAssistData] = useState<AssistData | null>(null);
  const [assistLoading, setAssistLoading] = useState(false);
  // P0-1: scores keyed by `${supplierId}:${scoreItemId}` (composite) — never flat by scoreItemId.
  // Task 7: `points` 子记录按 pointId 存 checklist 决策（checked + awardedScore）；onChange 时 Σ→score rollup。
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
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

  // P0-B: committedSupplierId 传入本次提交的供应商，合并刷新时仅覆盖该供应商、保留其他供应商未提交编辑
  const loadProject = useCallback((committedSupplierId?: string) => {
    setLoading(true);
    setLoadError(null);
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
        setInvalidSupplierIds(new Set((p.suppliers || []).filter(s => s.bidValidity === 'invalid').map(s => s.id))); // P2：用共享类型字段，去 unsafe cast
        // P0-1: hydrate with composite keys so each supplier's scores are isolated.
        const existing: Record<string, { score: number; reason: string }> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = { score: Number(rec.score), reason: rec.reason || '', ...(rec.passed !== null && rec.passed !== undefined ? { passed: rec.passed } : {}) };
        });
        // P0-B：合并而非覆盖——保留其他供应商尚未提交的内存编辑，仅用服务端值覆盖已提交供应商
        setScores(prev => {
          const next: typeof prev = { ...existing };
          for (const [k, v] of Object.entries(prev)) {
            if (committedSupplierId && k.startsWith(`${committedSupplierId}:`)) continue; // 已提交的用服务端值
            if (!(k in next)) next[k] = v; // 其他供应商的未提交编辑保留
          }
          return next;
        });
        // P2: sync per-supplier conflicts from server
        const serverConflicts: string[] = p.myExpertRecord?.conflictedSupplierIds || [];
        if (serverConflicts.length > 0) setConflictedSupplierIds(new Set(serverConflicts));
        // P4: hydrate confidentiality/discipline agreements from server (survives refresh)
        if (p.myExpertRecord?.confidentialityAgreed) setConfidentialityAgreed(true);
        if (p.myExpertRecord?.disciplineAgreed) setDisciplineAgreed(true);
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
                  points: { ...(cur.points ?? {}), [pd.pointId]: { checked: pd.checked, awardedScore: Number(pd.awardedScore), note: pd.note || undefined } },
                };
              }
              return next;
            });
          })
          .catch(() => { /* my-scores optional — ignore */ });
      })
      .catch((e: any) => setLoadError(e?.message || '加载项目失败')) // P1-16：记录错误态供重试
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
    // E4/G3: 先查 localStorage（快速），无草稿则尝试服务端恢复
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt: number };
        const count = Object.keys(draft.scores || {}).length;
        if (count > 0) { setDraftAvailable({ count, savedAt: draft.savedAt }); return; }
      }
    } catch { /* corrupt draft — ignore */ }
    // localStorage 无草稿，尝试从服务端恢复
    api.get<{ scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=desktop`)
      .then(d => {
        if (d && d.scores && Object.keys(d.scores).length > 0) {
          setDraftAvailable({ count: Object.keys(d.scores).length, savedAt: d.savedAt ?? Date.now() });
        }
      })
      .catch(() => {});
  }, [draftStorageKey, projectId]);

  // P0-3: debounced autosave whenever scores change (only while scoring).
  // E4/G3: 双写 localStorage（快速离线恢复）+ 服务端 scoreDraft API（跨设备持久化）
  useEffect(() => {
    if (!draftStorageKey || step !== 'scoring') return;
    const entries = Object.keys(scores).length;
    if (entries === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() }));
      } catch { /* quota / private mode — ignore */ }
      // E4/G3: 同步到服务端（失败静默降级到 localStorage）
      api.post(`/expert/projects/${projectId}/score-draft?device=desktop`, { scores, savedAt: Date.now() }).catch(() => {});
    }, 2000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [scores, draftStorageKey, step, projectId]);

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
    api.post(`/expert/projects/${projectId}/score-draft?device=desktop`, { scores: {}, savedAt: Date.now() }).catch(() => {});
    setDraftAvailable(null);
    setDraftDismissed(true);
  };
  const saveDraftNow = (snapshot?: Record<string, ScoreEntry>) => {
    if (!draftStorageKey) return;
    const payload = snapshot ?? scores;
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ scores: payload, savedAt: Date.now() }));
    } catch { /* quota — ignore */ }
    api.post(`/expert/projects/${projectId}/score-draft?device=desktop`, { scores: payload, savedAt: Date.now() })
      .then(() => toast.success('草稿已保存（已同步到服务端）'))
      .catch(() => toast.success('草稿已保存（本地）'));
  };

  // D：条款核对就地打分（仅草稿，写入 scores + 立即落库；supplierId 隐含 activeSupplier）
  const handlePointChange = useCallback((scoreItemId: string, pointId: string, value: PointDecisionValue) => {
    if (!activeSupplier) return;
    const k = scoreKey(activeSupplier, scoreItemId);
    const cur = scores[k] ?? { score: 0, reason: '' };
    const points = { ...(cur.points ?? {}), [pointId]: value };
    const si = project?.scoreItems.find((s) => s.id === scoreItemId);
    const score = (si?.points ?? []).reduce((s, p) => s + (points[p.id]?.awardedScore ?? 0), 0);
    // 通过性项：从客观分点重算 passed（与评分 tab checkbox onChange 逻辑一致）
    let passed = cur.passed;
    if (si && isPassFailCategory(si.category)) {
      const objectivePts = (si.points ?? []).filter(p => p.objective);
      passed = objectivePts.length > 0 && objectivePts.every(p => points[p.id]?.checked === true);
    }
    const next = { ...scores, [k]: { ...cur, points, score, reason: cur.reason ?? '', passed } };
    setScores(next);
    saveDraftNow(next);
    // undo toast for modifications (not new items)
    const oldPointVal = cur.points?.[pointId];
    if (oldPointVal && (oldPointVal.checked !== value.checked || oldPointVal.awardedScore !== value.awardedScore)) {
      const pointName = si?.points?.find(p => p.id === pointId)?.name ?? pointId;
      toast(`已将「${pointName}」修改`, {
        action: {
          label: '撤销',
          onClick: () => {
            handlePointChange(scoreItemId, pointId, oldPointVal);
          },
        },
        duration: 3000,
      });
    }
  }, [activeSupplier, scores, project]);

  // D：得分点级批注（写 points[pointId].note 草稿）
  const handlePointNote = useCallback((scoreItemId: string, pointId: string, note: string) => {
    if (!activeSupplier) return;
    const k = scoreKey(activeSupplier, scoreItemId);
    const cur = scores[k] ?? { score: 0, reason: '' };
    const points = { ...(cur.points ?? {}) };
    const existing = points[pointId] ?? { checked: false, awardedScore: 0 };
    points[pointId] = { ...existing, note };
    const next = { ...scores, [k]: { ...cur, points } };
    setScores(next);
    saveDraftNow(next);
  }, [activeSupplier, scores]);

  // 得分点选中（联动备忘抽屉）
  const handlePointClickDesk = useCallback(
    (pointId: string, pointName: string) => {
      setActivePointId(pointId);
      setActivePointName(pointName);
      if (project) {
        const item = project.scoreItems.find(si => (si.points ?? []).some(p => p.id === pointId));
        setActiveScoreItemId(item?.id ?? null);
      }
    },
    [project],
  );

  const handleMemoCountChange = useCallback((pid: string, count: number) => {
    setPointMemoCounts(prev => prev[pid] === count ? prev : { ...prev, [pid]: count });
  }, []);

  useEffect(() => { loadProject(); }, [loadProject]);

  // 批量加载当前供应商的 memo 计数（按 scorePointId reduce）
  useEffect(() => {
    if (!activeSupplier) return;
    listMemos(projectId, activeSupplier)
      .then(list => {
        const counts: Record<string, number> = {};
        for (const m of list) {
          if (m.scorePointId) counts[m.scorePointId] = (counts[m.scorePointId] ?? 0) + 1;
        }
        setPointMemoCounts(counts);
      })
      .catch(() => { /* silent */ });
  }, [activeSupplier, projectId]);

  const expert = project?.myExpertRecord;

  // Phase 0：条款响应核对右栏「相关评分项」状态（同类别只读指引）——
  // committed=已提交（myScores 有记录）/ draft=有未提交内存编辑 / empty=未填
  const scoreStatusByItem = useMemo(() => {
    const map: Record<string, { state: 'committed' | 'draft' | 'empty'; score: number; passed?: boolean }> = {};
    if (!project || !activeSupplier) return map;
    const committed = new Set(
      project.myScores.filter((r) => r.supplierId === activeSupplier).map((r) => r.scoreItemId),
    );
    for (const si of project.scoreItems) {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      if (committed.has(si.id)) {
        map[si.id] = { state: 'committed', score: entry?.score ?? 0, passed: entry?.passed };
      } else if (entry && ((entry.reason || '').trim() || entry.score > 0 || typeof entry.passed === 'boolean')) {
        map[si.id] = { state: 'draft', score: entry.score ?? 0, passed: entry.passed };
      } else {
        map[si.id] = { state: 'empty', score: 0 };
      }
    }
    return map;
  }, [project, activeSupplier, scores]);

  // Smart initial step: after project loads, jump to the most relevant step
  // based on expert progress (only runs once per page load)
  const initialStepComputed = useRef(false);
  useEffect(() => {
    if (!project || initialStepComputed.current) return;
    initialStepComputed.current = true;

    const er = project.myExpertRecord;
    if (!er) return;

    const verifyDone = er.signedIn && er.avoidanceConfirmed && er.aiConsentConfirmed
      && er.confidentialityAgreed && er.disciplineAgreed;
    if (!verifyDone) return; // stay on 'verify'

    const progress = er.progress ?? 0;
    if (progress >= 100) setStep('report');
    else if (progress > 0) setStep('scoring');
    else setStep('assist');
  }, [project]);

  // Guard: redirect to verify if current step is not accessible
  useEffect(() => {
    if (!project) return;
    if (!stepAccessible(step)) {
      setStep('verify');
    }
  }, [step, expert?.signedIn, expert?.avoidanceConfirmed, expert?.aiConsentConfirmed, expert?.reportConfirmed, expert?.progress, confidentialityAgreed, disciplineAgreed]);

  // 拍照留痕 → 上传照片（expert_signin_photo）→ 携带 photoAssetId 签到
  const handleFaceSuccess = async (photoBlob: Blob | null) => {
    setFaceVerified(true);
    setFaceVerifying(true);
    try {
      let photoAssetId: string | undefined;
      if (photoBlob) {
        try {
          const fd = new FormData();
          fd.append('file', photoBlob, `expert-signin-${Date.now()}.jpg`);
          const asset = await api.post<{ id: string }>('/upload?category=expert_signin_photo', fd);
          photoAssetId = asset.id;
        } catch {
          // 照片上传失败不阻塞签到——留痕缺失，但真实闸门（手机验证 + 服务端 sign-in）不受影响
          toast.warning('签到照片上传失败，本次签到将不带照片');
        }
      }
      await api.post(`/expert/projects/${projectId}/sign-in`, photoAssetId ? { photoAssetId } : {});
      setFaceVerifying(false);
      loadProject();
    } catch (e: any) {
      setFaceVerifying(false);
      setFaceVerified(false);
      toast.error(e.message || '签到失败，请重试');
    }
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

  const handleRefreshDocuments = async () => {
    if (!projectId) return;
    setRefreshingDocs(true);
    try {
      // 刷新招标文件 + 供应商列表（只更新这两个字段，不扰动 scores 等状态）
      const data = await api.get<ExpertProjectDetail>(`/expert/projects/${projectId}`);
      setProject(prev => prev ? { ...prev, tenderDocument: data.tenderDocument, suppliers: data.suppliers } : prev);
      // 刷新投标文件
      const batchSeq = ++docSeqRef.current;
      setDocuments({});
      await Promise.all(data.suppliers.map(s => loadDocuments(s.id, batchSeq)));
      if (!data.tenderDocument) {
        toast.message('招标文件可能未上传，请联系管理员');
      }
    } catch (e: any) {
      toast.error(e?.message || '刷新失败');
    }
    setRefreshingDocs(false);
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
    // P1-15：评分完整性校验（与平板端共用 validateSupplierScores）
    const missing = validateSupplierScores(project.scoreItems, scores, activeSupplier, scoreKey).map(m => m.itemId);
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
        // 通过性项有 points → 必须发 pointDecisions（后端 recomputeItemFromDecisions 算 passed）
        if (hasPoints) {
          const ptEntries = Object.entries(entry?.points ?? {});
          return {
            scoreItemId: si.id, supplierId: activeSupplier, reason: entry?.reason ?? '',
            pointDecisions: ptEntries.length > 0
              ? ptEntries.map(([pid, d]) => ({ pointId: pid, checked: d.checked, awardedScore: d.awardedScore }))
              : (si.points ?? []).map(p => ({ pointId: p.id, checked: entry?.passed === true, awardedScore: entry?.passed === true ? Number(p.fullScore) : 0 })),
          };
        }
        return { scoreItemId: si.id, supplierId: activeSupplier, passed: entry?.passed, reason: entry?.reason ?? '' };
      }
      if (hasPoints) {
        // Task 7: checklist 模式 —— 附 pointDecisions，后端据其核定 score。
        return {
          scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '',
          pointDecisions: Object.entries(entry?.points ?? {}).map(([pointId, d]) => ({ pointId, checked: d.checked, awardedScore: d.awardedScore, note: d.note })),
        };
      }
      return { scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '' };
    });
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/scores`, { scores: scoresPayload, supplierName });
      // P0-B：不再整键删除草稿（会误删其他供应商未提交分）；合并刷新后自动暂存按剩余未提交分重写
      setDraftAvailable(null);
      loadProject(activeSupplier);
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

  // C2: 组长末签
  const handleLeaderCoSign = async () => {
    if (!confirm('末签后将锁定评审报告，可生成评标结果。是否继续？')) return;
    setBusy(true);
    try { await api.post(`/expert/projects/${projectId}/leader-cosign`, {}); loadProject(); toast.success('组长末签完成'); }
    catch (e: any) { toast.error(e.message || '末签失败'); }
    setBusy(false);
  };
  const isLead = !!expert?.isLead;
  // P1 收口：experts 数组不再带逐人 reportConfirmed——改用服务端聚合计数
  const ep = (project as any)?.expertPresence;
  const allMembersConfirmed = !!ep && ep.totalExperts > 0 && ep.reportConfirmedCount === ep.totalExperts;
  const leaderCoSigned = !!(project as any)?.leaderCoSigned;
  // C1/C3: 动议+投票（只读记录——功能操作在工作台「评审待办」页面）
  const [motions, setMotions] = useState<any[]>([]);
  useEffect(() => {
    if (project) { api.get(`/expert/projects/${projectId}/motions`).then((res: any) => setMotions(res)).catch(() => {}); }
  }, [project?.id]);
  // D2: 异议工单（只读记录——功能操作在工作台「评审待办」页面）
  const [disputes, setDisputes] = useState<any[]>([]);
  useEffect(() => {
    if (project) { api.get(`/expert/projects/${projectId}/disputes`).then((res: any) => setDisputes(res)).catch(() => {}); }
  }, [project?.id]);

  if (loadError) return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
      <p>加载失败：{loadError}</p>
      <button type="button" onClick={() => loadProject()} className="neu-btn-primary !h-[38px]">
        重试
      </button>
    </div>
  );
  if (loading || !project) return <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">加载中...</div>;
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
          className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold text-[oklch(0.52_0.13_70)] transition hover:bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]">
          <AlertTriangle size={11} strokeWidth={1.5} /> {open ? '收起' : '插入异议/疑问'}
        </button>
        {open && (
          <div className="exp-alert exp-alert--warn mt-1.5 space-y-1.5 !p-2 !font-normal">
            {notes.map((dsp, idx) => {
              const id = noteId(activeSupplier, dsp.requirementId);
              const inserted = insertedKeys.has(id);
              return (
                <label key={`rev-${dsp.requirementId}-${idx}`}
                  onMouseDown={() => { suppressBlurRef.current = true; }}
                  className={`flex items-start gap-2 rounded-[8px] px-2 py-1 text-xs ${inserted ? 'opacity-60' : 'hover:bg-[oklch(1_0_0/0.5)]'}`}>
                  <input type="checkbox" checked={inserted} disabled={inserted}
                    onChange={() => onToggleNote(k, activeSupplier, dsp, itemId)}
                    className="neu-checkbox mt-0.5 !h-[18px] !w-[18px]" />
                  <div className="min-w-0 flex-1">
                    <span className="exp-pill mr-1" style={{ '--c': dsp.verdict === 'dispute' ? 'var(--danger)' : 'var(--warning)' } as React.CSSProperties}>
                      {dsp.verdict === 'dispute' ? '异议' : '疑问'}
                    </span>
                    <span className="font-semibold text-[var(--foreground)]">{dsp.content?.slice(0, 40) || '(原文缺失)'}</span>
                    {dsp.note && <div className="mt-0.5 opacity-80">{dsp.note}</div>}
                    {inserted && <div className="mt-0.5 text-[10px] opacity-70">已插入</div>}
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
        <div className={`exp-alert mb-3 flex shrink-0 items-center justify-between gap-3 !px-4 ${_wsConn === 'reconnecting' ? 'exp-alert--warn' : ''}`}>
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} strokeWidth={1.5} />{_wsConn === 'reconnecting' ? '实时连接中断，正在重连…' : '实时连接已断开，数据可能不是最新'}</span>
          <button onClick={_wsReconnect} className={`neu-btn-xs ${_wsConn === 'reconnecting' ? 'is-warning' : 'is-danger'}`}>重试</button>
        </div>
      )}

      {/* 顶部导航 */}
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => router.push('/projects')} className="neu-btn-xs">
            <ArrowLeft size={14} strokeWidth={1.5} /> 返回
          </button>
          <span className="h-6 w-px shrink-0 bg-[oklch(0.6_0.04_258/0.25)]" />
          <h1 className="truncate text-xl font-bold text-[var(--foreground)]">{project.name}</h1>
          <span className="exp-code-chip shrink-0">{project.projectCode}</span>
        </div>
        <div className="flex items-center gap-3">
          <LiveStatusBoard
            connection={_wsConn} lastEventAt={_wsLastEvent} onReconnect={_wsReconnect}
            aggregate={aggregatePresence} events={liveEvents}
            unreadMessageCount={unreadMessageCount}
            onOpenMessages={() => { setShowMessages(!showMessages); if (!showMessages) setUnreadMessageCount(0); }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { setShowMessages(!showMessages); if (!showMessages) setUnreadMessageCount(0); }}
            className="neu-btn-xs is-info">
            <MessageSquare size={13} strokeWidth={1.5} /> 开标消息
            {unreadMessageCount > 0 && (
              <span className="ml-1 rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold leading-tight text-white">{unreadMessageCount}</span>
            )}
          </button>
          <button onClick={() => { setShowClarifications(!showClarifications); if (!showClarifications) loadClarifications(); }}
            className="neu-btn-xs is-info">
            <MessageSquare size={13} strokeWidth={1.5} /> 澄清答疑
          </button>
        </div>
      </div>

      {/* P2: clarifications panel (toggled from header) */}
      {showClarifications && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setShowClarifications(false)} />
          <div className="exp-dialog relative flex max-h-[90vh] min-h-[50vh] w-full max-w-3xl flex-col space-y-3 p-5" role="dialog" aria-modal="true" aria-label="澄清与答疑">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]"><MessageSquare size={14} strokeWidth={1.5} />澄清与答疑</h3>
            <button onClick={() => setShowClarifications(false)} aria-label="关闭" className="neu-btn-xs is-square"><X size={14} strokeWidth={1.5} /></button>
          </div>
          {clarifications.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无澄清记录</p>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {clarifications.map((c: any) => (
                <div key={c.id} className="neu-card-static !rounded-[14px] p-3 text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-bold text-[var(--foreground)]">{c.issuer}</span>
                    <span className="text-[var(--muted-foreground)]">→ {c.supplierName}</span>
                    <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{new Date(c.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="mb-1 text-[var(--foreground)]">Q: {c.question}</p>
                  {c.reply ? (
                    <p className="exp-alert exp-alert--success !p-1.5">A: {c.reply}</p>
                  ) : (
                    <p className="italic text-[var(--muted-foreground)]">待回复</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Post new question */}
          <div className="space-y-2 pt-3">
            <hr className="wb-section-rule" />
            <select value={clarSupplier} onChange={e => {
                const sel = project.suppliers.find(s => s.supplierName === e.target.value);
                setClarSupplier(e.target.value);
                setClarSupplierId(sel?.supplierId || '');
              }}
              className="neu-select w-full !h-8 !text-xs">
              <option value="">选择供应商（必选）</option>
              {project.suppliers.map(s => (
                <option key={s.id} value={s.supplierName}>{s.supplierName}</option>
              ))}
            </select>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className="mb-1 flex justify-end">
                  <button type="button" onClick={draftClarificationQ} disabled={clarDrafting || !clarSupplierId}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-strong)] hover:underline disabled:opacity-40">
                    <Sparkles size={11} /> {clarDrafting ? '起草中…' : 'AI 起草'}
                  </button>
                </div>
                <textarea value={clarQuestion} onChange={e => setClarQuestion(e.target.value)}
                  placeholder="向所选供应商发起澄清…（Ctrl+Enter 发送）"
                  rows={4}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postClarification(); } }}
                  className="neu-input resize-y !text-xs" />
              </div>
              <button onClick={postClarification} disabled={clarPosting} className="neu-btn-primary !h-[38px]">
                {clarPosting ? '…' : '发送'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* D1: 开标大厅消息面板（toggled from header） */}
      {showMessages && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setShowMessages(false)} />
          <div className="exp-dialog relative flex max-h-[80vh] min-h-[40vh] w-full max-w-lg flex-col p-0" role="dialog" aria-modal="true" aria-label="开标大厅消息">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-[var(--muted-foreground)]">按 Esc 或点击遮罩关闭</span>
              <button onClick={() => setShowMessages(false)} aria-label="关闭" className="neu-btn-xs is-square"><X size={14} strokeWidth={1.5} /></button>
            </div>
            <HallMessagePanel
              messages={hallMessages}
              onOpen={() => setUnreadMessageCount(0)}
            />
          </div>
        </div>
      )}

      {/* 步骤指示器 — cgzxui .exp-steps：当前品牌蓝凸起 / 完成绿 / 未到禁用 */}
      <div className="mb-3 shrink-0">
        <div className="exp-steps px-1">
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
                  className={`exp-step ${
                    isCurrent ? 'is-current' : completed ? 'is-done' : accessible ? '' : 'is-locked'
                  }`}
                >
                  <span className="exp-step-num">
                    {completed ? <CheckCircle size={11} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <s.Icon size={13} strokeWidth={1.5} />
                  {s.label}
                </button>
                {i < STEPS.length - 1 && (
                  <span className={`exp-step-connector ${completed ? 'is-done' : ''}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 主内容区：供应商侧边栏 + 内容（wb-panel 渐变底板，无外侧框线）
          — wb-panel 默认 flex-direction:column（globals.css 未分层，优先级高于 Tailwind 工具类），
            此处需左右分栏，故用 !flex-row 强制行向；否则供应商侧栏会竖向堆叠把正文向下挤 */}
      <div className="wb-panel flex !flex-row min-h-0 min-w-0 flex-1 overflow-hidden">
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
        <div className="flex-1 overflow-hidden min-h-0 min-w-0">
          <div className="h-full overflow-y-auto">
          {/* ====== 身份核验 ====== */}
          {step === 'verify' && (
            <div className="mx-auto max-w-3xl p-6">
              <h2 className="mb-6 text-xl font-bold text-[var(--foreground)]">身份核验与承诺确认</h2>

              <div className="mb-6 space-y-4">
                {/* ===== ① 身份核验 — 始终可用 ===== */}
                <div>
                  <div className="neu-card-static flex items-center gap-4 p-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
                      expert?.signedIn
                        ? 'bg-[var(--success)] text-white'
                        : 'bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                    }`}>
                      {expert?.signedIn ? <Check size={18} strokeWidth={2.5} /> : '1'}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${expert?.signedIn ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>身份核验</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">确认您的专家身份信息</p>
                    </div>
                    {!expert?.signedIn && (
                      <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待完成</span>
                    )}
                  </div>
                  {/* 拍照留痕 + 签到 — 未签到时显示 */}
                  {!expert?.signedIn && (
                    <div className="neu-card-static mt-3 p-4">
                      {faceVerified ? (
                        <div className="exp-alert exp-alert--success flex items-center gap-3">
                          <CheckCircle size={20} strokeWidth={1.5} className="shrink-0" />
                          <div>
                            <p className="text-sm font-semibold">照片留痕已提交</p>
                            <p className="text-xs opacity-80">
                              {faceVerifying ? '正在签到…' : '签到完成'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <SigninCamera
                          userName={expert?.expertName}
                          onSignIn={handleFaceSuccess}
                          busy={faceVerifying}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* ===== ② 保密承诺 — 签到完成后解锁 ===== */}
                <div className={!expert?.signedIn ? 'pointer-events-none select-none opacity-50' : ''}>
                  <div className="neu-card-static flex items-center gap-4 p-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
                      confidentialityAgreed
                        ? 'bg-[var(--success)] text-white'
                        : expert?.signedIn
                          ? 'bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                          : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
                    }`}>
                      {confidentialityAgreed ? <Check size={18} strokeWidth={2.5} /> : expert?.signedIn ? '2' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        confidentialityAgreed ? 'text-[var(--success)]'
                        : expert?.signedIn ? 'text-[var(--foreground)]'
                        : 'text-[var(--muted-foreground)]'
                      }`}>保密承诺</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">承诺不泄露评标过程中获取的信息</p>
                    </div>
                    {!expert?.signedIn && (
                      <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>需先完成身份核验</span>
                    )}
                    {expert?.signedIn && !confidentialityAgreed && (
                      <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待签署</span>
                    )}
                  </div>
                  {/* 保密承诺书 — 解锁后且未签署时显示 */}
                  {expert?.signedIn && !confidentialityAgreed && (
                    <div className="exp-alert exp-alert--info mt-3 space-y-3 !p-4 !font-normal">
                      <h3 className="flex items-center gap-2 !text-sm !font-bold text-[var(--foreground)]">
                        <Clipboard size={14} strokeWidth={1.5} /> 保密承诺书
                      </h3>
                      <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                        本人作为本项目评审专家，郑重承诺：在评标过程中严格遵守保密规定，不向任何第三方泄露评标过程中获取的投标文件内容、评审意见及其他相关信息。如有违反，愿意承担相应法律责任。
                      </p>
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" checked={confidentialityAgreed} onChange={e => {
                          setConfidentialityAgreed(e.target.checked);
                          api.patch(`/expert/projects/${projectId}/agreements`, { confidentialityAgreed: e.target.checked }).catch(() => {});
                        }}
                          className="neu-checkbox" />
                        <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并同意以上保密承诺</span>
                      </label>
                    </div>
                  )}
                  {/* 已签署确认条 */}
                  {expert?.signedIn && confidentialityAgreed && (
                    <div className="exp-alert exp-alert--success mt-3 flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
                      <span className="text-sm">已签署保密承诺书</span>
                    </div>
                  )}
                </div>

                {/* ===== ③ 评标纪律 — 保密承诺签署后解锁 ===== */}
                <div className={!confidentialityAgreed ? 'pointer-events-none select-none opacity-50' : ''}>
                  <div className="neu-card-static flex items-center gap-4 p-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
                      disciplineAgreed
                        ? 'bg-[var(--success)] text-white'
                        : confidentialityAgreed
                          ? 'bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                          : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
                    }`}>
                      {disciplineAgreed ? <Check size={18} strokeWidth={2.5} /> : confidentialityAgreed ? '3' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        disciplineAgreed ? 'text-[var(--success)]'
                        : confidentialityAgreed ? 'text-[var(--foreground)]'
                        : 'text-[var(--muted-foreground)]'
                      }`}>评标纪律</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">遵守独立评审原则</p>
                    </div>
                    {!confidentialityAgreed && (
                      <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>需先签署保密承诺</span>
                    )}
                    {confidentialityAgreed && !disciplineAgreed && (
                      <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待确认</span>
                    )}
                  </div>
                  {/* 评标纪律 — 解锁后且未确认时显示 */}
                  {confidentialityAgreed && !disciplineAgreed && (
                    <div className="exp-alert exp-alert--info mt-3 space-y-3 !p-4 !font-normal">
                      <h3 className="flex items-center gap-2 !text-sm !font-bold text-[var(--foreground)]">
                        <Gavel size={14} strokeWidth={1.5} /> 评标纪律承诺
                      </h3>
                      <ul className="mb-1 space-y-2 text-sm text-[var(--muted-foreground)]">
                        <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>严格按照招标文件规定的评审标准和方法进行评审</li>
                        <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>独立评审，不与其他专家串通或私下交流评审意见</li>
                        <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>客观公正，不带任何偏见和个人倾向</li>
                        <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>对评审过程和结果保密，不向任何人透露</li>
                      </ul>
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" checked={disciplineAgreed} onChange={e => {
                          setDisciplineAgreed(e.target.checked);
                          api.patch(`/expert/projects/${projectId}/agreements`, { disciplineAgreed: e.target.checked }).catch(() => {});
                        }}
                          className="neu-checkbox" />
                        <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并同意遵守以上评标纪律</span>
                      </label>
                    </div>
                  )}
                  {/* 已确认条 */}
                  {confidentialityAgreed && disciplineAgreed && (
                    <div className="exp-alert exp-alert--success mt-3 flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
                      <span className="text-sm">已确认评标纪律</span>
                    </div>
                  )}
                </div>

                {/* ===== ④ AI 辅助评标声明 — 评标纪律确认后解锁 ===== */}
                <div className={!disciplineAgreed ? 'pointer-events-none select-none opacity-50' : ''}>
                  <div className="neu-card-static flex items-center gap-4 p-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
                      expert?.aiConsentConfirmed
                        ? 'bg-[var(--success)] text-white'
                        : disciplineAgreed
                          ? 'bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                          : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
                    }`}>
                      {expert?.aiConsentConfirmed ? <Check size={18} strokeWidth={2.5} /> : disciplineAgreed ? '4' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        expert?.aiConsentConfirmed ? 'text-[var(--success)]'
                        : disciplineAgreed ? 'text-[var(--foreground)]'
                        : 'text-[var(--muted-foreground)]'
                      }`}>AI 辅助评标声明</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">确认 AI 辅助结果仅供参考</p>
                    </div>
                    {!disciplineAgreed && (
                      <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>需先确认评标纪律</span>
                    )}
                    {disciplineAgreed && !expert?.aiConsentConfirmed && (
                      <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待签署</span>
                    )}
                  </div>
                  {/* AI 声明书 — 解锁后且未确认时显示 */}
                  {disciplineAgreed && !expert?.aiConsentConfirmed && (
                    <div className="exp-alert exp-alert--info mt-3 space-y-3 !p-4 !font-normal">
                      <h3 className="flex items-center gap-2 !text-sm !font-bold text-[var(--foreground)]">
                        <Sparkles size={14} strokeWidth={1.5} /> AI 辅助评标使用声明
                      </h3>
                      <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                        本项目评审引入人工智能（大语言模型与文档识别）辅助工具，可对投标文件进行合规性检查、风险提示与评分参考分析。本人郑重声明并知悉：
                      </p>
                      <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
                        <p>一、AI 辅助工具生成的合规判断、风险提示、评分建议等内容，性质均为<strong className="text-[var(--foreground)]">辅助参考</strong>，不构成评审结论；</p>
                        <p>二、上述 AI 意见仅供本人在评标过程中参考，<strong className="text-[var(--foreground)]">不得干预或干扰本人的独立职业判断</strong>；</p>
                        <p>三、任何 AI 输出均<strong className="text-[var(--foreground)]">不得作为本人打分的直接依据或唯一理由</strong>，本人对每一项评分及其理由独立负责；</p>
                        <p>四、最终评审意见与评分结果，由本人依据招标文件规定的标准和方法、结合专业判断独立作出，不由 AI 决定，亦不因 AI 意见而免除本人的评审责任。</p>
                      </div>
                      <p className="text-sm font-medium text-[var(--muted-foreground)]">本人确认已阅读并充分理解上述声明。</p>
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" checked={aiConsentChecked} onChange={e => setAiConsentChecked(e.target.checked)}
                          className="neu-checkbox" />
                        <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并知悉以上声明</span>
                      </label>
                      <button onClick={handleConfirmAiConsent} disabled={!aiConsentChecked || busy}
                        className="neu-btn-primary !h-[38px]">
                        {busy ? '确认中…' : '确认同意'}
                      </button>
                    </div>
                  )}
                  {/* 已确认条 */}
                  {disciplineAgreed && expert?.aiConsentConfirmed && (
                    <div className="exp-alert exp-alert--success mt-3 flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
                      <span className="text-sm">已确认 AI 辅助评标声明</span>
                    </div>
                  )}
                </div>
              </div>

              {/* P2/D4: per-supplier avoidance declaration — 评审中可重新声明 */}
              {expert?.signedIn && (
                <div className="exp-alert exp-alert--warn mt-6 !p-5 !font-normal">
                  <h3 className="mb-2 flex items-center gap-2 !text-sm font-bold text-[var(--foreground)]">
                    <Lock size={14} strokeWidth={1.5} className="shrink-0" /> 利益冲突回避
                  </h3>
                  <p className="mb-4 text-sm text-[var(--muted-foreground)]">
                    请逐项核对：若您与以下任一投标单位存在利益关系（如曾受雇、近亲属供职、持有股份等），请勾选声明回避。
                    被回避的供应商将不会出现在您的评分列表中。
                    <br/><span className="font-semibold text-[var(--warning)]">评审过程中可在任何时候补充或调整回避声明（系统自动检测的冲突不会被清除）。</span>
                  </p>
                  <div className="mb-4 space-y-1.5">
                    {project.suppliers.map(sup => {
                      const isConflict = conflictedSupplierIds.has(sup.id);
                      return (
                        <label key={sup.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-[10px] p-2.5 transition ${
                            isConflict ? 'bg-[color-mix(in_oklch,var(--danger)_8%,transparent)]' : 'hover:bg-[oklch(1_0_0/0.5)]'
                          }`}>
                          <input type="checkbox" checked={isConflict}
                            onChange={e => {
                              setConflictedSupplierIds(prev => {
                                const n = new Set(prev);
                                e.target.checked ? n.add(sup.id) : n.delete(sup.id);
                                return n;
                              });
                            }}
                            className="neu-checkbox" />
                          <span className="flex-1 text-sm font-semibold text-[var(--foreground)]">{sup.supplierName}</span>
                          {isConflict && (
                            <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>已声明回避</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <button onClick={handleAvoidance} disabled={avoiding} className="neu-btn-primary">
                    {avoiding ? '提交中…' : `确认回避声明（${conflictedSupplierIds.size} 家冲突 / ${project.suppliers.length - conflictedSupplierIds.size} 家无冲突）`}
                  </button>
                </div>
              )}

              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && expert?.aiConsentConfirmed && (
                <div className="exp-alert exp-alert--success mt-4 flex items-center gap-3 !p-4">
                  <CheckCircle size={20} strokeWidth={1.5} className="shrink-0" />
                  <div>
                    <h3 className="!text-sm !font-bold">核验完成</h3>
                    <p className="!text-sm opacity-80">您已完成身份核验，可以开始评审工作</p>
                  </div>
                  <button onClick={() => setStep('documents')} className="neu-btn-primary is-success ml-auto !h-[38px]">
                    进入标书获取 →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ====== 标书获取 ====== */}
          {step === 'documents' && (
            <DocumentsStep project={project} documents={documents} onRefresh={handleRefreshDocuments} refreshing={refreshingDocs} />
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
                scoreItems={project.scoreItems}
                scoreStatus={scoreStatusByItem}
                onGoScoring={async (target) => {
                  // E：发送 focus hint 到平板 + ACK 回执轮询（确认平板实际收到）
                  const toastId = toast.loading('正在发送到平板…');
                  try {
                    const res = await api.post<{ ok: boolean; seq: number }>(
                      `/expert/projects/${projectId}/focus-hint`,
                      { supplierId: activeSupplier, ...target },
                    );
                    // 轮询 ACK：4 次 × 2s = 8s 窗口
                    let acked = false;
                    for (let i = 0; i < 4; i++) {
                      await new Promise(r => setTimeout(r, 2000));
                      try {
                        const ack = await api.get<{ acked: boolean }>(
                          `/expert/projects/${projectId}/focus-hint/ack?seq=${res.seq}`,
                        );
                        if (ack?.acked) { acked = true; break; }
                      } catch { /* 网络抖动 — 视为未确认，继续轮询 */ }
                    }
                    if (acked) {
                      toast.success('平板已接收，请在平板上查看', { id: toastId });
                    } else {
                      toast.warning('未检测到平板接收，请确认平板已登录同一账号并打开评审页', { id: toastId });
                    }
                  } catch {
                    toast.error('发送到平板失败，请重试', { id: toastId });
                  }
                }}
                scores={scores}
                onPointChange={handlePointChange}
                onPointNote={handlePointNote}
                pointMemoCounts={pointMemoCounts}
                selectedPointId={activePointId}
                onPointClick={(pid, pname) => {
                  handlePointClickDesk(pid, pname);
                  setMemoOpen(true);
                }}
              />
            </div>
          )}

          {/* ====== 专家打分 ====== */}
          {step === 'scoring' && (
            <div className="p-6">
              {/* WS 同步冲突横幅 */}
              {draftConflicts.length > 0 && (
                <div className="mb-4 flex items-center gap-3 rounded-[10px] px-4 py-2"
                  style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)', borderLeft: '3px solid var(--warning)' }}>
                  <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />
                  <span className="flex-1 text-xs font-semibold text-[var(--warning)]">
                    检测到 {draftConflicts.length} 项评分变更（来自平板端）
                  </span>
                  <button type="button"
                    onClick={() => setConflictModalOpen(true)}
                    className="neu-btn-xs !h-9 !px-3">处理</button>
                </div>
              )}
              <div className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[var(--foreground)]">专家独立打分</h2>
                  <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">请根据您的专业判断进行客观评分</p>
                </div>
                {/* Task 6: 评分历史入口（替代备忘按钮） */}
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="neu-btn-xs shrink-0"
                  aria-label="查看评分历史"
                >
                  <History size={14} strokeWidth={1.7} /> 评分历史
                </button>
              </div>

              {/* P1 专家间可见性收口（2026-08-15）：表决动态不再出现在打分步骤——
                  他人表决倾向会引导独立评分（「供评分参考」表述本身即违背独立评审）。
                  动议/表决的查看与操作归「评审待办」页与报告步（ReportStep）。 */}

              {/* P0-3: draft recovery banner */}
              {draftAvailable && !draftDismissed && (
                <div className="exp-alert exp-alert--warn mb-6 flex items-center gap-3 !p-4">
                  <ClipboardList size={20} strokeWidth={1.5} className="shrink-0" />
                  <div className="flex-1">
                    <p className="!text-sm !font-bold">检测到未提交的评分草稿</p>
                    <p className="mt-0.5 !text-xs opacity-80">
                      {draftAvailable.count} 项评分 · 保存于 {new Date(draftAvailable.savedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <button onClick={discardDraft} className="neu-btn-xs">丢弃</button>
                  <button onClick={restoreDraft} className="neu-btn-primary !h-[30px] !px-4">恢复草稿</button>
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
                      const catColor = CATEGORY_COLOR[category] || 'var(--accent-strong)';
                      return (
                        <div key={category} className={`exp-category-group ${disputed ? '!shadow-[inset_0_1px_0_oklch(1_0_0/0.8),2px_2px_5px_oklch(0.55_0.03_258/0.1),-1.5px_-1.5px_4px_oklch(1_0_0/0.85),inset_0_0_0_1.5px_color-mix(in_oklch,var(--warning)_55%,transparent)]' : ''}`}>
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <span className="exp-category-chip" style={{ '--cat': catColor } as React.CSSProperties} />
                              <span className="text-sm font-bold text-[var(--foreground)]">
                                {CATEGORY_LABEL[category] || category}
                              </span>
                              <span className="text-xs text-[var(--muted-foreground)]">{items.length} 项</span>
                              {disputed && (
                                <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
                                  <AlertTriangle size={9} strokeWidth={2} /> 有异议条款待核对
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {isPassFailCategory(category) ? (
                                <span className="text-sm font-bold text-[var(--muted-foreground)]">通过性审查</span>
                              ) : (
                                <>
                                  <span className="text-xs text-[var(--muted-foreground)]">得分</span>
                                  <span className="text-lg font-bold text-[var(--accent-strong)]">{catScored}</span>
                                  <span className="text-xs text-[var(--muted-foreground)]">/ {catTotal}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="space-y-4">
                            {/* Task 4: 异议备注区 — disputed category 顶部列出异议条款摘要 + note，供专家打分参考 */}
                            {disputed && (disputesBySupplier[activeSupplier]?.[category]?.filter((d) => d.verdict === 'dispute').length ?? 0) > 0 && (
                              <div className="exp-alert exp-alert--warn space-y-2 !p-3">
                                <div className="flex items-center gap-1.5 !text-xs font-bold">
                                  <AlertTriangle size={12} strokeWidth={1.5} /> 异议备注（{disputesBySupplier[activeSupplier][category].filter((d) => d.verdict === 'dispute').length} 条 · 聚焦下方理由框可勾选复选框引用）
                                </div>
                                <ul className="space-y-1.5">
                                  {disputesBySupplier[activeSupplier][category].filter((d) => d.verdict === 'dispute').map((dsp, idx) => (
                                    <li key={`${dsp.requirementId}-${idx}`} className="rounded-[8px] bg-[oklch(1_0_0/0.6)] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
                                      <div className="truncate font-semibold" title={dsp.content}>条款：{dsp.content}</div>
                                      {dsp.note && <div className="mt-0.5 opacity-80">异议：{dsp.note}</div>}
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
                              // P1: 价格分公式引擎 — PRICE 项由系统自动算分
                              const isPriceFormula = item.category === 'PRICE' && !!(project as any)?.priceFormulaConfig;
                              const isLastItem = idx === items.length - 1;
                              if (passFail) {
                                const verdict = val?.passed;
                                const pfPoints = (item.points ?? []).map(p => ({ id: p.id, name: p.name, fullScore: p.fullScore, objective: p.objective, evidenceHint: p.evidenceHint, seq: p.seq }));
                                const hasPoints = pfPoints.length > 0;
                                // effective value: stored points → passed fallback → default unchecked
                                const pfValueMap: Record<string, PointDecisionValue> = {};
                                for (const pt of pfPoints) {
                                  const stored = val?.points?.[pt.id];
                                  if (stored) pfValueMap[pt.id] = stored;
                                  else if (verdict === true) pfValueMap[pt.id] = { checked: true, awardedScore: Number(pt.fullScore) };
                                  else pfValueMap[pt.id] = { checked: false, awardedScore: 0 };
                                }
                                return (
                                  <div key={item.id} data-score-item={item.id} className={`neu-card-static !rounded-[14px] p-4 ${reasonMissing ? '!shadow-[inset_0_1px_0_oklch(1_0_0/0.7),2px_2px_6px_oklch(0.55_0.03_258/0.1),-2px_-2px_6px_oklch(1_0_0/0.8),inset_0_0_0_1.5px_color-mix(in_oklch,var(--danger)_55%,transparent)]' : ''}`}>
                                    <div className="mb-3 flex items-center justify-between">
                                      <h4 className="font-semibold text-[var(--foreground)]">{item.name}</h4>
                                      {hasPoints ? (
                                        <span className={`text-sm font-bold ${verdict === true ? 'text-[var(--success)]' : verdict === false ? 'text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}`}>
                                          {verdict === true ? '✓ 通过' : verdict === false ? '✗ 不通过' : '未评'}
                                        </span>
                                      ) : null}
                                    </div>
                                    {!hasPoints && (
                                      <div className="mb-3 flex items-center gap-3">
                                        <button type="button"
                                          onClick={() => setScores(prev => ({ ...prev, [k]: { score: 0, reason: prev[k]?.reason || '', passed: true } }))}
                                          className={`neu-btn-soft is-success ${verdict === true ? '!bg-[oklch(0.96_0.05_164/0.5)]' : ''}`}>
                                          {verdict === true && <Check size={14} strokeWidth={2.5} />}通过
                                        </button>
                                        <button type="button"
                                          onClick={() => setScores(prev => ({ ...prev, [k]: { score: 0, reason: prev[k]?.reason || '', passed: false } }))}
                                          className={`neu-btn-soft is-danger ${verdict === false ? '!bg-[oklch(0.96_0.05_27/0.5)]' : ''}`}>
                                          {verdict === false && <X size={14} strokeWidth={2.5} />}不通过
                                        </button>
                                      </div>
                                    )}
                                    {hasPoints && (
                                      <div className="mb-3">
                                        <PointChecklistScoring
                                          points={pfPoints}
                                          value={pfValueMap}
                                          onChange={(pid, pv) => setScores(prev => {
                                            const cur = prev[k] ?? { score: 0, reason: '' };
                                            const points = { ...(cur.points ?? pfValueMap), [pid]: pv };
                                            // auto-compute passed: 所有客观分点全勾选 = 通过
                                            const objectivePts = pfPoints.filter(p => p.objective);
                                            const allChecked = objectivePts.length > 0 && objectivePts.every(p => points[p.id]?.checked === true);
                                            return { ...prev, [k]: { ...cur, points, score: 0, reason: cur.reason ?? '', passed: allChecked } };
                                          })}
                                          selectedPointId={activePointId}
                                          onPointClick={handlePointClickDesk}
                                          pointMemoCounts={pointMemoCounts}
                                        />
                                      </div>
                                    )}
                                    {verdict === false && (
                                      <textarea placeholder="不通过理由（必填）" value={val?.reason || ''}
                                        onFocus={() => onReasonFocus(k)}
                                        onBlur={onReasonBlur}
                                        onChange={e => {
                                          const v = e.target.value;
                                          setScores(prev => ({ ...prev, [k]: { score: 0, reason: v, passed: false, points: prev[k]?.points } }));
                                          if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                                        }}
                                        className="neu-input !min-h-[64px] !text-sm"
                                        aria-invalid={reasonMissing ? 'true' : undefined}
                                        aria-label={`${item.name} 不通过理由`} />
                                    )}
                                    {/* Task 5: pass-fail 「不通过」理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                    {verdict === false && renderReviewPanel(k, category, item.id)}
                                    {reasonMissing && <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-[var(--danger)]"><AlertTriangle size={12} strokeWidth={1.5} />请选择「通过 / 不通过」，不通过需填理由</p>}
                                  </div>
                                );
                              }
                              // P1: PRICE 公式项 → 只读展示,无打分输入
                              if (isPriceFormula) {
                                return (
                                  <div key={item.id} data-score-item={item.id} className="neu-card-static !rounded-[14px] p-4">
                                    <div className="flex items-center justify-between">
                                      <h4 className="font-semibold text-[var(--foreground)]">{item.name}</h4>
                                      <span className="rounded-md bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">系统公式计算</span>
                                    </div>
                                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">满分 {item.maxScore} · 价格分由公式引擎根据报价自动计算,无需专家打分</p>
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
                                  <div key={item.id} data-score-item={item.id} className={`neu-card-static !rounded-[14px] p-4 ${reasonMissing ? '!shadow-[inset_0_1px_0_oklch(1_0_0/0.7),2px_2px_6px_oklch(0.55_0.03_258/0.1),-2px_-2px_6px_oklch(1_0_0/0.8),inset_0_0_0_1.5px_color-mix(in_oklch,var(--danger)_55%,transparent)]' : ''}`}>
                                    <div className="mb-3 flex items-center justify-between">
                                      <h4 className="font-semibold text-[var(--foreground)]">{item.name}</h4>
                                      <span className="text-sm text-[var(--muted-foreground)]">满分 {max}</span>
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
                                      })}
                                      selectedPointId={activePointId}
                                      onPointClick={handlePointClickDesk}
                                      pointMemoCounts={pointMemoCounts}
                                    />
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
                                      className="neu-input mt-3 !min-h-[64px] !text-sm"
                                      aria-invalid={reasonMissing ? 'true' : undefined}
                                      aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                    {/* Task 5: 数值项理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                    {renderReviewPanel(k, category, item.id)}
                                    {reasonMissing && <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-[var(--danger)]"><AlertTriangle size={12} strokeWidth={1.5} />该项得分低于满分，请填写评分理由</p>}
                                  </div>
                                );
                              }
                              // 无 points → 旧滑块（轨道填充经 CSS 变量传递，无字面内联色值）
                              return (
                                <div key={item.id} data-score-item={item.id} className={`neu-card-static !rounded-[14px] p-4 ${reasonMissing ? '!shadow-[inset_0_1px_0_oklch(1_0_0/0.7),2px_2px_6px_oklch(0.55_0.03_258/0.1),-2px_-2px_6px_oklch(1_0_0/0.8),inset_0_0_0_1.5px_color-mix(in_oklch,var(--danger)_55%,transparent)]' : ''}`}>
                                  <div className="mb-3 flex items-center justify-between">
                                    <h4 className="font-semibold text-[var(--foreground)]">{item.name}</h4>
                                    <span className="text-sm text-[var(--muted-foreground)]">满分 {max}</span>
                                  </div>
                                  <div className="mb-3 flex items-center gap-4">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                                      className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,var(--fill)_var(--pct),oklch(0.96_0.01_258)_var(--pct))] accent-[var(--accent-strong)] focus:outline-none"
                                      style={{ '--fill': catColor, '--pct': `${pct}%` } as React.CSSProperties}
                                      aria-label={`${item.name} 评分`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={currentScore} aria-valuetext={`${currentScore} / ${max} 分`} tabIndex={0} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.max(0, Math.min(parseFloat(e.target.value) || 0, max)), reason: prev[k]?.reason || '' } }))}
                                      onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); const v = Math.min((currentScore || 0) + 0.5, max); setScores(prev => ({ ...prev, [k]: { score: v, reason: prev[k]?.reason || '' } })); } else if (e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max((currentScore || 0) - 0.5, 0); setScores(prev => ({ ...prev, [k]: { score: v, reason: prev[k]?.reason || '' } })); } handleScoringKeyDown(e, isLastItem); }}
                                      className="exp-score-input"
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
                                    className="neu-input !min-h-[64px] !text-sm"
                                    aria-invalid={reasonMissing ? 'true' : undefined}
                                    aria-label={`${item.name} 评分理由`} tabIndex={0} />
                                  {/* Task 5: 数值项理由框聚焦（或点📎按钮）→ 展开复选框面板 */}
                                  {renderReviewPanel(k, category, item.id)}
                                  {reasonMissing && <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-[var(--danger)]"><AlertTriangle size={12} strokeWidth={1.5} />该项得分低于满分，请填写评分理由</p>}
                                </div>
                              );
                            })}
                          </div>
                          {disputed && (
                            <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-2.5 text-xs font-semibold text-[oklch(0.52_0.13_70)]">
                              <input
                                type="checkbox"
                                className="neu-checkbox !h-[18px] !w-[18px]"
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
                    <div className="neu-card-static p-6">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-bold text-[var(--foreground)]">评分汇总 — {scoringSupplierName}</h3>
                        <div className="text-right">
                          <div className="text-3xl font-bold text-[var(--accent-strong)]">
                            {project.scoreItems.reduce((s, si) => s + (scores[scoreKey(activeSupplier, si.id)]?.score ?? 0), 0)}
                          </div>
                          <div className="text-sm text-[var(--muted-foreground)]">
                            满分 {project.scoreItems.reduce((s, si) => s + Number(si.maxScore), 0)}
                          </div>
                        </div>
                      </div>
                      {scoreLocked && (
                        <div className="exp-alert exp-alert--warn mb-4">
                          评审报告已确认，评分已锁定，不可再修改。
                        </div>
                      )}
                      {!canScoreActiveSupplier && !scoreLocked && (
                        <div className="exp-alert exp-alert--warn mb-4">
                          当前投标单位未解密成功或已撤回，不能提交评分。
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        {!scoreLocked && (
                          <button onClick={() => saveDraftNow()} disabled={busy} className="neu-btn-soft">
                            保存草稿
                          </button>
                        )}
                        <button onClick={handleSubmitScores} disabled={busy || !canScoreActiveSupplier || scoreLocked}
                          className="neu-btn-primary flex-1">
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
            <ReportStep report={report} busy={busy} onConfirmReport={handleConfirmReport}
              isLead={isLead} leaderCoSigned={leaderCoSigned} allMembersConfirmed={allMembersConfirmed}
              onLeaderCoSign={handleLeaderCoSign} motions={motions} disputes={disputes} myExpertId={expert?.id} projectId={projectId} />
          )}
            </div>
          </div>
        </div>

        {/* ====== P5 Task 7: 桌面端备忘抽屉（scoring / verify-score 可开启；键盘输入 + 查看平板墨迹）====== */}
        {memoOpen && (step === 'scoring' || step === 'verify-score') && (
          <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="备注面板">
            {/* 点击遮罩关闭 */}
            <div
              className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
              onClick={() => setMemoOpen(false)}
              aria-label="关闭备注面板"
              role="button"
            />
            <aside className="wb-panel relative z-10 flex h-full w-[400px] max-w-[90vw] flex-col !rounded-r-none">
              <div className="flex shrink-0 items-center justify-between px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
                  <StickyNote size={14} strokeWidth={1.7} /> 备注
                  {activeSupplier && (
                    <span className="exp-pill ml-1" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>
                      {project?.suppliers.find(s => s.id === activeSupplier)?.supplierName || '当前供应商'}
                    </span>
                  )}
                  {activePointName && (
                    <span className="exp-pill ml-1 max-w-[120px] truncate" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>
                      {activePointName}
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={() => setMemoOpen(false)}
                  aria-label="关闭"
                  className="neu-btn-xs is-square"
                >
                  <X size={16} strokeWidth={1.7} />
                </button>
              </div>
              <hr className="wb-section-rule shrink-0" />
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeSupplier ? (
                  <MemoPanel
                    projectId={projectId}
                    supplierId={activeSupplier}
                    scorePointId={activePointId ?? undefined}
                    scorePointName={activePointName || undefined}
                    scoreItemId={activeScoreItemId ?? undefined}
                    sourceDevice="desktop"
                    onMemoCountChange={handleMemoCountChange}
                  />
                ) : (
                  <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">请先在左侧选择供应商</p>
                )}
              </div>
            </aside>
          </div>
        )}
        {/* 冲突裁决弹窗 */}
        <SyncConflictModal
          open={conflictModalOpen}
          newItems={[]}
          conflictItems={draftConflicts.map(c => ({
            key: c.key,
            scoreItemName: c.scoreItemName,
            localVal: c.localVal,
            remoteVal: c.remoteVal,
            remoteDevice: 'tablet',
          }))}
          localDevice="desktop"
          onConfirm={(resolved) => {
            setScores(prev => {
              const next = { ...prev };
              for (const c of draftConflicts) {
                if (resolved[c.key] === 'remote') next[c.key] = c.remoteVal;
              }
              return next;
            });
            setDraftConflicts([]);
            setConflictModalOpen(false);
          }}
          onClose={() => setConflictModalOpen(false)}
        />
        {/* 评分历史抽屉 */}
        <ScoreHistoryDrawer
          open={historyOpen}
          projectId={projectId}
          supplierId={activeSupplier}
          suppliers={project?.suppliers.map(s => ({ id: s.id, supplierName: s.supplierName })) ?? []}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
  );
}
