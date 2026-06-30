'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import { buildViewModel } from './ai-bid-workspace-view-model';
import type {
  AiBidAnalysisTask,
  AiBidTaskStatus,
} from '@/lib/types/ai-bid-analysis';

const POLLING_STATES: AiBidTaskStatus[] = [
  'ANALYZING',
  'TENDER_PROCESSING',
  'BIDDERS_PROCESSING',
];

export function useAiBidWorkspace(taskId: string) {
  const [task, setTask] = useState<AiBidAnalysisTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const taskDetail = await aiBidAnalysisApi.getTask(taskId);
      setTask(taskDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载任务详情失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!task || !POLLING_STATES.includes(task.status)) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(() => {
      void load();
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [task, load]);

  const viewModel = useMemo(() => (task ? buildViewModel(task) : null), [task]);

  return { task, error, loading, reload: load, viewModel };
}
