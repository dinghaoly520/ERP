'use client';

/**
 * AI 辅助评标进度卡片——评标管理 tab 顶部独立一行。
 * 3s 轮询 GET /bid/projects/:id/ai-analysis-progress（worker 独立进程无 WS，只能轮询）；
 * task 终态且无异常后停止轮询。异常时显示补救按钮：
 *   - 重试失败项：POST retry-ai-bidders（不传 ids = 全部 FAILED+卡住家）
 *   - 重新分析：POST rerun-ai-analysis（清空全部结果重跑，二次确认；N8 存量无任务时自动补建——
 *     卡片在 task 不存在分支直接给一键补建入口，无需二次确认，因无旧结果可清）
 * 分工 v3 下评标管理 tab 为 :3007 现场全操作端（启动评标·专家进度·评分矩阵·排名·3 步生成评标结果向导·专家异议裁决·澄清答疑），本卡片是其中 AI 通道：
 * 写操作（重试/重新分析）非阶段流转；阶段流转按 v3——启动评标在本 tab（:3007），完整归档在 :3005（spec: 2026-08-13-expert-paper-signing-design §2）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, AlertTriangle, RefreshCw, Loader, X, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAiAnalysisProgress, retryAiBidders, rerunAiAnalysis,
  type AiAnalysisProgress,
} from '@/lib/api/bid';

const POLL_MS = 3000;

/* 任务状态中文文案 */
const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '等待分析启动',
  TENDER_PROCESSING: '招标文件处理中',
  ANALYZING: '逐家分析中',
  COMPLETED: '分析完成',
  COMPLETED_WITH_ERRORS: '分析完成（部分失败）',
  FAILED: '招标文件处理失败',
  CANCELLED: '已取消',
};

function ProgressRing({ pct, size = 40, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, pct / 100);
  const color = pct >= 100 ? 'oklch(0.54 0.16 158)' : 'oklch(0.56 0.153 251)';
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.94 0.004 264)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="absolute text-[10px] font-extrabold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
    </div>
  );
}

export default function AiAnalysisCard({ projectId, stage }: { projectId: string; stage: string }) {
  const [progress, setProgress] = useState<AiAnalysisProgress | null>(null);
  const [busy, setBusy] = useState<'retry' | 'rerun' | null>(null);
  const [rerunConfirm, setRerunConfirm] = useState(false);
  const stoppedRef = useRef(false);

  const load = useCallback(async (): Promise<AiAnalysisProgress | null> => {
    try {
      const p = await getAiAnalysisProgress(projectId);
      if (!stoppedRef.current) setProgress(p);
      return p;
    } catch {
      return null; // 轮询静默容错；下次 tick 再试
    }
  }, [projectId]);

  useEffect(() => {
    // 阶段门控：非 EVALUATING（OPENING/ARCHIVED/ABORTED 回看）只拉一次快照，不轮询、不显示补救按钮
    if (stage !== 'EVALUATING') {
      stoppedRef.current = false;
      void load().finally(() => { stoppedRef.current = true; });
      return () => { stoppedRef.current = true; };
    }
    stoppedRef.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = async () => {
      const p = await load();
      if (cancelled) return;
      // 停止条件：task 存在且终态且无异常——异常终态继续轮询（用户重试/重新分析后状态复位即自动继续刷新）
      if (p?.exists && p.taskStatus && !['PENDING', 'TENDER_PROCESSING', 'ANALYZING'].includes(p.taskStatus) && !p.anomaly.hasAnomaly) {
        if (timer) { clearInterval(timer); timer = null; }
      }
    };

    void tick();
    timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; stoppedRef.current = true; if (timer) clearInterval(timer); };
  }, [load, stage]);

  const doRetry = async () => {
    setBusy('retry');
    try {
      const res = await retryAiBidders(projectId);
      toast.success(`已重新入队 ${res.retried.length} 家：${res.retried.map((r) => r.name).join('、')}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || '重试失败');
    } finally {
      setBusy(null);
    }
  };

  const doRerun = async () => {
    setRerunConfirm(false);
    setBusy('rerun');
    try {
      await rerunAiAnalysis(projectId);
      // N8：存量补建路径无旧结果可清，文案对两条路径保持中性
      toast.success('已重新入队全量 AI 分析');
      await load();
    } catch (e: any) {
      toast.error(e?.message || '重新分析失败');
    } finally {
      setBusy(null);
    }
  };

  /* ── 未启动（无 task）── */
  if (progress && !progress.exists) {
    // N8：存量项目（先于 AI 分析特性创建）无任务——不再永久「等待分析任务创建」，
    // 后端 rerunAiAnalysis 已支持自动补建 task 并入队，此处给出可见可点的恢复入口
    return (
      <div className="neu-card-static flex items-center gap-3 p-4">
        <Bot size={16} strokeWidth={1.5} className="shrink-0 text-[color:var(--muted-foreground)]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">AI辅助评标</span>
        <span className="min-w-0 flex-1 text-[12px] text-[color:var(--muted-foreground)]">
          {stage === 'EVALUATING' ? '未创建 AI 分析任务（存量项目）——点击重新分析可补建并启动' : '启动评标后自动开始 AI 辅助分析'}
        </span>
        {stage === 'EVALUATING' && (
          <button onClick={doRerun} disabled={busy !== null}
            className="neu-btn-xs inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.56 0.153 251)] disabled:opacity-50">
            {busy === 'rerun' ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            重新分析
          </button>
        )}
      </div>
    );
  }

  if (!progress) return null; // 首次加载中不占位（避免跳动）

  const { total, completed, failed, anomaly, taskStatus } = progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const inProgress = taskStatus === 'PENDING' || taskStatus === 'TENDER_PROCESSING' || taskStatus === 'ANALYZING';
  // 补救按钮仅在 EVALUATING 阶段可用（ARCHIVED/ABORTED 回看为只读快照）
  const actionsEnabled = stage === 'EVALUATING';
  const showRetry = actionsEnabled && (anomaly.failedNames.length > 0 || anomaly.stuckNames.length > 0);
  const showRerun = actionsEnabled && (anomaly.taskFailed || anomaly.allPending || anomaly.failedNames.length > 0 || anomaly.stuckNames.length > 0);

  return (
    <div className={`neu-card-static p-4 ${anomaly.hasAnomaly ? 'bg-[oklch(0.97_0.03_83_/_0.35)]' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* 左：环 + 计数 */}
        <div className="flex items-center gap-3">
          {anomaly.taskFailed
            ? <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[oklch(0.97_0.03_22_/_0.6)]"><AlertTriangle size={16} className="text-[var(--danger)]" /></span>
            : <ProgressRing pct={pct} />}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">AI辅助评标</span>
              {inProgress && !anomaly.hasAnomaly && <Loader size={11} className="animate-spin text-[oklch(0.56_0.153_251)]" />}
            </div>
            <div className="text-[1.15rem] font-black leading-tight tracking-[-0.04em] tabular-nums text-[color:var(--foreground)]">
              <span className={failed > 0 ? 'text-[var(--danger)]' : 'text-[oklch(0.54_0.16_158)]'}>{completed}</span>
              <span className="text-[color:var(--muted-foreground)]">/{total} 家</span>
            </div>
          </div>
        </div>

        {/* 中：状态文案 */}
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
          {anomaly.taskFailed ? (
            <span className="font-semibold text-[var(--danger)]">招标文件处理失败——需重新分析</span>
          ) : anomaly.allPending ? (
            <span className="font-semibold text-[oklch(0.64_0.16_82)]">分析未启动——请确认 AI 分析 worker 进程已运行；worker 恢复后队列将自动消费</span>
          ) : anomaly.failedNames.length > 0 ? (
            <span><span className="font-semibold text-[var(--danger)]">{failed} 家分析失败：</span>{anomaly.failedNames.join('、')}</span>
          ) : anomaly.stuckNames.length > 0 ? (
            <span><span className="font-semibold text-[oklch(0.64_0.16_82)]">疑似卡住：</span>{anomaly.stuckNames.join('、')}（超 30 分钟无进展）</span>
          ) : (
            <span>{TASK_STATUS_LABEL[taskStatus ?? ''] ?? taskStatus}</span>
          )}
        </div>

        {/* 右：操作按钮（仅异常时出现） */}
        {showRerun && (
          <div className="flex shrink-0 items-center gap-2">
            {showRetry && (
              <button onClick={doRetry} disabled={busy !== null}
                className="neu-btn-xs inline-flex items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.56_0.153_251)] disabled:opacity-50">
                {busy === 'retry' ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                重试失败项
              </button>
            )}
            <button onClick={() => setRerunConfirm(true)} disabled={busy !== null}
              className="neu-btn-xs inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50">
              <RefreshCw size={11} />
              重新分析
            </button>
          </div>
        )}
      </div>

      {/* 重新分析二次确认 */}
      {rerunConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setRerunConfirm(false)} />
          <div className="bid-dialog relative mx-4 w-full max-w-[min(440px,92vw)]" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
              <h3 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-[color:var(--foreground)]">
                <ShieldAlert size={16} className="text-[var(--danger)]" />
                确认重新分析
              </h3>
              <button type="button" onClick={() => setRerunConfirm(false)} className="neu-btn-xs" aria-label="关闭"><X size={15} /></button>
            </div>
            <hr className="wb-section-rule mx-6" />
            <div className="space-y-4 px-6 py-5">
              <div className="flex items-start gap-2.5 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[oklch(0.46_0.11_65)]" />
                <div className="space-y-1 text-[12px] leading-relaxed tracking-tight text-[oklch(0.46_0.11_65)]">
                  <p className="font-bold">将清空全部已完成的 AI 分析结果并重新分析所有供应商</p>
                  <p>已生成的评分、一致性与报告数据将被删除，分析需重新 OCR 全部标书，耗时较长。</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRerunConfirm(false)} className="neu-btn-xs text-[12px]">取消</button>
                <button onClick={doRerun} className="neu-btn-xs bg-[var(--danger)] text-[12px] font-semibold text-white">确认重新分析</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
