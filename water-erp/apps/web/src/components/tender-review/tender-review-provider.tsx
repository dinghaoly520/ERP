'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { TenderReviewContext, type TenderReviewContextValue, type TenderReviewTab, type TenderReviewLoadingState, type TenderReviewErrorState } from './tender-review-context';
import { fetchKnowledgeBases } from '@/lib/api/knowledge';
import { fetchCurrentUser } from '@/lib/api/auth';
import { fetchReviewTasks, fetchTodayStats, type TodayStats } from '@/lib/api/review';
import type { KnowledgeBase, ReviewTask } from '@/lib/types/tender-review';

interface Props {
  children: React.ReactNode;
  onReviewComplete?: ((task: ReviewTask) => Promise<void>) | null;
}

export function TenderReviewProvider({ children, onReviewComplete }: Props) {
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TenderReviewTab>('review');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [stats, setStats] = useState<TodayStats>({ totalReviews: 0, passedCount: 0, failedCount: 0, warningCount: 0 });
  const [selectedReportTask, setSelectedReportTask] = useState<ReviewTask | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string } | null>(null);

  const [loading, setLoading] = useState<TenderReviewLoadingState>({
    kbs: false,
    tasks: false,
    rules: false,
  });

  const [error, setError] = useState<TenderReviewErrorState>({
    kbs: null,
    tasks: null,
    rules: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const runningTasks = useMemo(() =>
    tasks.filter(t => t.status === 'running' || t.status === 'pending'),
    [tasks]
  );

  const recentReviews = useMemo(() =>
    tasks
      .filter(t => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
    [tasks]
  );

  const refreshStats = useCallback(async () => {
    try {
      const data = await fetchTodayStats();
      setStats(data);
    } catch {
      // stats refresh is non-critical, silently ignore
    }
  }, []);

  // silent=true 供 5s 轮询静默刷新：不动 loading 态（否则右侧栏每拍骨架屏闪烁，2026-11-06 实录）、
  // 失败不弹 toast（轮询失败每 5s 一弹会成为新噪音）；仅首载/手动刷新走完整态
  const refreshKnowledgeBases = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) {
      setLoading(prev => ({ ...prev, kbs: true }));
      setError(prev => ({ ...prev, kbs: null }));
    }
    try {
      const data = await fetchKnowledgeBases();
      setKnowledgeBases(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载知识库失败';
      if (!silent) {
        setError(prev => ({ ...prev, kbs: msg }));
        toast.error(msg);
      }
    } finally {
      if (!silent) setLoading(prev => ({ ...prev, kbs: false }));
    }
  }, []);

  // silent=true 供 2s 任务轮询静默刷新（不动 loading 态——否则报告面板每拍骨架屏闪烁，
  // 2026-11-06 与 refreshKnowledgeBases 同方补齐）；仅首载/手动刷新走完整态
  const refreshTasks = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) {
      setLoading(prev => ({ ...prev, tasks: true }));
      setError(prev => ({ ...prev, tasks: null }));
    }
    try {
      const data = await fetchReviewTasks();
      setTasks(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载审查任务失败';
      if (!silent) setError(prev => ({ ...prev, tasks: msg }));
    } finally {
      if (!silent) setLoading(prev => ({ ...prev, tasks: false }));
    }
  }, []);

  useEffect(() => {
    refreshKnowledgeBases();
    refreshTasks();
    refreshStats();
  }, [refreshKnowledgeBases, refreshTasks, refreshStats]);

  // Polling for running tasks
  const prevRunningCountRef = useRef(0);
  useEffect(() => {
    if (runningTasks.length > 0) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(() => {
          void refreshTasks({ silent: true });
        }, 2000);
      }
    } else if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Refresh stats only when running tasks drop to 0 (tasks completed)
    if (prevRunningCountRef.current > 0 && runningTasks.length === 0) {
      refreshStats();
    }
    prevRunningCountRef.current = runningTasks.length;

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [runningTasks.length, refreshTasks, refreshStats]);

  // 当前用户（知识库属主判断用）
  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setCurrentUser({ id: u.id, role: u.role }))
      .catch(() => setCurrentUser(null));
  }, []);

  const value: TenderReviewContextValue = {
    selectedKbId,
    currentUser,
    activeTab,
    knowledgeBases,
    runningTasks,
    recentReviews,
    stats,
    tasks,
    selectedReportTask,
    setSelectedKbId,
    setActiveTab,
    setSelectedReportTask,
    refreshKnowledgeBases,
    refreshTasks,
    loading,
    error,
    onReviewComplete: onReviewComplete ?? null,
  };

  return (
    <TenderReviewContext.Provider value={value}>
      {children}
    </TenderReviewContext.Provider>
  );
}
