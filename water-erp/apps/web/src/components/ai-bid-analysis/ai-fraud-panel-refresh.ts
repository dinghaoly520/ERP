import type { FraudIndicators } from "@/lib/types/ai-bid-analysis";

interface LoadFraudDetectionOptions {
  taskId: string;
  loadFraudDetection: (taskId: string) => Promise<FraudIndicators>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setFraudData: (data: FraudIndicators) => void;
  reloadTask?: () => Promise<void> | void;
}

export async function loadFraudDetectionPanelData({
  taskId,
  loadFraudDetection,
  setLoading,
  setError,
  setFraudData,
  reloadTask,
}: LoadFraudDetectionOptions) {
  setLoading(true);
  setError(null);
  try {
    const data = await loadFraudDetection(taskId);
    setFraudData(data);
    if (reloadTask) {
      await reloadTask();
    }
  } catch {
    setError('加载串通检测数据失败');
  } finally {
    setLoading(false);
  }
}
