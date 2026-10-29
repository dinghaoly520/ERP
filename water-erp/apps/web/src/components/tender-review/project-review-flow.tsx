'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, ShieldAlert, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ReadyTenderDocumentType, ReadyTenderDraft } from '@/lib/types/tender-write';
import type { ReviewTask } from '@/lib/types/tender-review';
import { useTenderReview } from './tender-review-context';
import ReportViewCombined from './report-view-combined';
import {
  checkProjectStatus,
  executeReview,
  fetchReviewTask,
  stopReviewTask,
  uploadReviewDocument,
} from '@/lib/api/review';
import { exportTenderDocument } from '@/lib/api/tender-write';
import { fetchUserSettings } from '@/lib/api/user-settings';

type Phase = 'checking' | 'config' | 'starting' | 'running' | 'result' | 'failed';
type ReviewMode = 'strict' | 'general';

interface ProjectReviewFlowProps {
  projectId: string;
  documentType: ReadyTenderDocumentType;
  answers: ReadyTenderDraft;
  projectCode?: string;
}

const MODE_OPTIONS: Array<{ value: ReviewMode; label: string; desc: string }> = [
  { value: 'general', label: '智能审查', desc: 'AI 逐章节语义分析，覆盖面广，耗时较长' },
  { value: 'strict', label: '规则审查', desc: '按知识库规则逐条比对，速度快、结论可解释' },
];

/** 项目管理场景的审查三态流：配置卡 → 进度 → 结果（spec §7） */
export default function ProjectReviewFlow({ projectId, documentType, answers, projectCode }: ProjectReviewFlowProps) {
  const { knowledgeBases } = useTenderReview();
  const [phase, setPhase] = useState<Phase>('checking');
  const [fingerprint, setFingerprint] = useState('');
  const [staleSource, setStaleSource] = useState(false); // 结果来自过期草稿
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [pollTaskId, setPollTaskId] = useState<string | null>(null);
  const [kbId, setKbId] = useState('');
  const [kbResolved, setKbResolved] = useState(false);
  const [mode, setMode] = useState<ReviewMode>('general');
  // 挂载时快照草稿——避免编辑过程中的对象引用变化触发重复检查
  const draftSnapshot = useRef(answers);

  // ---------- 挂载时判定状态（一次性） ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await checkProjectStatus({
          projectId,
          documentType,
          answers: draftSnapshot.current as unknown as Record<string, unknown>,
        });
        if (!alive) return;
        setFingerprint(st.fingerprint);
        if (st.state === 'running' && st.task) {
          setTask(st.task);
          setPollTaskId(st.task.id);
          setPhase('running');
        } else if (st.state === 'matching' && st.task) {
          setTask(st.task);
          setPhase('result');
        } else if (st.state === 'stale' && st.task?.status === 'completed') {
          setTask(st.task);
          setStaleSource(true);
          setPhase('result');
        } else if (st.state === 'stale' && st.task?.status === 'failed') {
          setTask(st.task);
          setPhase('failed');
        } else {
          setPhase('config');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '审查状态查询失败');
        setPhase('config');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 默认知识库解析（设置值 → 第一个启用库 → 置空） ----------
  useEffect(() => {
    if (kbResolved || knowledgeBases.length === 0) return;
    let cancelled = false;
    (async () => {
      let def = '';
      try {
        const settings = await fetchUserSettings();
        const remembered = settings.defaultReviewKbId;
        if (remembered && knowledgeBases.some((kb) => kb.id === remembered)) def = remembered;
      } catch { /* 设置读取失败回退 */ }
      if (!def) {
        const firstActive = knowledgeBases.find((kb) => kb.isActive);
        def = firstActive?.id ?? '';
      }
      if (!cancelled) { setKbId(def); setKbResolved(true); }
    })();
    return () => { cancelled = true; };
  }, [knowledgeBases, kbResolved]);

  // ---------- 运行中轮询 ----------
  useEffect(() => {
    if (phase !== 'running' || !pollTaskId) return;
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchReviewTask(pollTaskId);
        if (fresh.status === 'completed') { setTask(fresh); setPollTaskId(null); setPhase('result'); }
        else if (fresh.status === 'failed') { setTask(fresh); setPollTaskId(null); setPhase('failed'); }
        else setTask(fresh);
      } catch { /* 单次轮询失败忽略，下轮重试 */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [phase, pollTaskId]);

  // ---------- 开始审查（导出 → 上传 → execute） ----------
  const handleStart = useCallback(async () => {
    if (!kbId) { toast.error('请选择知识库'); return; }
    setPhase('starting');
    try {
      const exported = await exportTenderDocument({ documentType, answers, projectCode });
      const file = new File([exported.blob], exported.fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const uploaded = await uploadReviewDocument(file);
      const exec = await executeReview({
        knowledgeBaseId: kbId,
        reviewMode: mode,
        documentContent: uploaded.content,
        documentName: uploaded.documentName,
        objectKey: uploaded.objectKey,
        projectId,
        fingerprint,
      });
      setTask({ id: exec.taskId, status: 'running', documentName: uploaded.documentName, reviewMode: mode } as ReviewTask);
      setPollTaskId(exec.taskId);
      setPhase('running');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动审查失败');
      setPhase('config');
    }
  }, [kbId, mode, documentType, answers, projectCode, projectId, fingerprint]);

  const handleStop = useCallback(async () => {
    const id = pollTaskId ?? task?.id;
    if (!id) return;
    try {
      await stopReviewTask(id);
      setPhase('failed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止失败');
    }
  }, [pollTaskId, task?.id]);

  const backToConfig = useCallback((prefill?: ReviewTask) => {
    if (prefill?.knowledgeBaseId) setKbId(prefill.knowledgeBaseId);
    if (prefill?.reviewMode) setMode(prefill.reviewMode);
    setStaleSource(false);
    setPhase('config');
  }, []);

  // ---------- 渲染 ----------
  if (phase === 'checking' || phase === 'starting') {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">
            {phase === 'checking' ? '正在核对审查状态…' : '正在导出并启动审查…'}
          </span>
        </div>
      </div>
    );
  }

  if (phase === 'config') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div
          className="w-full max-w-[420px] rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-6"
          style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.85), 3px 4px 14px oklch(0.45 0.07 258 / 0.12)' }}
        >
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">开始审查</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
            选择用于比对的制度知识库与审查方式，启动后本次选择将自动记住。
          </p>

          <label className="mt-5 block text-xs font-semibold text-[color:var(--foreground)]">知识库</label>
          <select
            value={kbId}
            onChange={(e) => setKbId(e.target.value)}
            className="mt-1.5 w-full h-10 rounded-xl border border-[oklch(0.6_0.04_258/0.18)] bg-white/80 px-3 text-sm"
          >
            {knowledgeBases.length === 0 && <option value="">暂无可用知识库，请先在独立审查页创建</option>}
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}{kb.isActive ? '' : '（未启用）'}</option>
            ))}
          </select>

          <label className="mt-4 block text-xs font-semibold text-[color:var(--foreground)]">审查方式</label>
          <div className="mt-1.5 space-y-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  mode === opt.value
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]/30'
                    : 'border-[oklch(0.6_0.04_258/0.14)] bg-white/60 hover:border-[oklch(0.6_0.04_258/0.28)]'
                }`}
              >
                <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                  mode === opt.value ? 'border-[color:var(--accent)] bg-[color:var(--accent)]' : 'border-[oklch(0.6_0.04_258/0.4)]'
                }`} />
                <span>
                  <span className="block text-sm font-medium text-[color:var(--foreground)]">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={knowledgeBases.length === 0}
            className="neu-btn-primary mt-6 w-full gap-2 !h-10 text-sm"
          >
            <Play size={14} />开始审查
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-4 rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-8">
          <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
          <div className="text-center">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">审查进行中</div>
            <div className="mt-1 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
              正在分析采购文件，完成后自动展示结果。<br />{task?.documentName}
            </div>
          </div>
          <button type="button" onClick={() => void handleStop()} className="neu-btn-soft gap-2 !h-9 text-xs">
            <StopCircle size={14} />停止审查
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    const reason = (task?.results as { error?: string } | null)?.error || '审查未能完成';
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-4 rounded-2xl border border-[oklch(0.6_0.04_258/0.14)] bg-white/70 p-8">
          <ShieldAlert size={28} className="text-[color:var(--danger)]" />
          <div className="text-center">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">审查未完成</div>
            <div className="mt-1 break-all text-xs leading-relaxed text-[color:var(--muted-foreground)]">{reason}</div>
          </div>
          <button type="button" onClick={() => backToConfig(task ?? undefined)} className="neu-btn-primary gap-2 !h-10 text-sm">
            <RefreshCw size={14} />重新审查
          </button>
        </div>
      </div>
    );
  }

  // phase === 'result'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {staleSource && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-[oklch(0.75_0.14_75/0.35)] bg-[oklch(0.97_0.03_75/0.4)] px-3 py-2 text-xs text-[color:var(--foreground)]">
          <ShieldAlert size={14} className="shrink-0 text-[color:var(--warning)]" />
          <span className="flex-1">文档在本次审查后有修改，以下结果可能已过期</span>
          <button type="button" onClick={() => backToConfig()} className="neu-btn-xs gap-1">
            <RefreshCw size={12} />重新审查
          </button>
        </div>
      )}
      {task && <ReportViewCombined task={task} onBack={() => backToConfig(task)} />}
    </div>
  );
}
