'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { TenderReviewContext, type TenderReviewContextValue, type TenderReviewTab, type TenderReviewLoadingState, type TenderReviewErrorState } from './tender-review-context';
import { fetchKnowledgeBases } from '@/lib/api/knowledge';
import { fetchReviewTasks, fetchTodayStats, type TodayStats } from '@/lib/api/review';
import type { KnowledgeBase, ReviewTask } from '@/lib/types/tender-review';

interface Props {
  children: React.ReactNode;
  onReviewComplete?: ((task: ReviewTask) => Promise<void>) | null;
}

export function TenderReviewProvider({ children, onReviewComplete }: Props) {
  // State
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TenderReviewTab>('review');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [stats, setStats] = useState<TodayStats>({ totalReviews: 0, passedCount: 0, failedCount: 0, warningCount: 0 });
  const [selectedReportTask, setSelectedReportTask] = useState<ReviewTask | null>(null);

  // Loading states
  const [loading, setLoading] = useState<TenderReviewLoadingState>({
    kbs: false,
    tasks: false,
    rules: false,
  });

  // Error states
  const [error, setError] = useState<TenderReviewErrorState>({
    kbs: null,
    tasks: null,
    rules: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Derived state
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

  // Data fetching
  const refreshKnowledgeBases = useCallback(async () => {
    setLoading(prev => ({ ...prev, kbs: true }));
    setError(prev => ({ ...prev, kbs: null }));
    try {
      const data = await fetchKnowledgeBases();
      setKnowledgeBases(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载知识库失败';
      setError(prev => ({ ...prev, kbs: msg }));
      toast.error(msg);
    } finally {
      setLoading(prev => ({ ...prev, kbs: false }));
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    setLoading(prev => ({ ...prev, tasks: true }));
    setError(prev => ({ ...prev, tasks: null }));
    try {
      const data = await fetchReviewTasks();
      setTasks(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载审查任务失败';
      setError(prev => ({ ...prev, tasks: msg }));
    } finally {
      setLoading(prev => ({ ...prev, tasks: false }));
    }
  }, []);

  // Initial load
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
          refreshTasks();
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

  const value: TenderReviewContextValue = {
    selectedKbId,
    activeTab,
    knowledgeBases,
    runningTasks,
    recentReviews,
    stats,
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
