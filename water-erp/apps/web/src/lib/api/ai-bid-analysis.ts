// apps/web/src/lib/api/ai-bid-analysis.ts
import type {
  AiBidAnalysisTask,
  AiBidder,
  AiTenderFile,
  CreateTaskDto,
  AddBidderDto,
  TaskProgress,
  AiBidReport,
  TenderRequirements,
  FraudIndicators,
  HealthStatus,
} from '../types/ai-bid-analysis';
import { normalizeApiBaseUrl } from './auth';

function getApiBase() {
  return normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error: ${res.status} - ${error}`);
  }

  return res.json();
}

export const aiBidAnalysisApi = {
  // Task CRUD
  createTask: (data: CreateTaskDto) =>
    fetchApi<AiBidAnalysisTask>('/ai-bid-analysis/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTasks: () =>
    fetchApi<AiBidAnalysisTask[]>('/ai-bid-analysis/tasks'),

  getTask: (id: string) =>
    fetchApi<AiBidAnalysisTask>(`/ai-bid-analysis/tasks/${id}`),

  deleteTask: (id: string) =>
    fetchApi<{ success: boolean }>(`/ai-bid-analysis/tasks/${id}`, {
      method: 'DELETE',
    }),

  // Bidders
  addBidder: (taskId: string, data: AddBidderDto) =>
    fetchApi<AiBidder>(`/ai-bid-analysis/tasks/${taskId}/bidders`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteBidder: (taskId: string, bidderId: string) =>
    fetchApi<{ success: boolean }>(`/ai-bid-analysis/tasks/${taskId}/bidders/${bidderId}`, {
      method: 'DELETE',
    }),

  getBidders: (taskId: string) =>
    fetchApi<AiBidder[]>(`/ai-bid-analysis/tasks/${taskId}/bidders`),

  // Progress
  getProgress: (taskId: string) =>
    fetchApi<TaskProgress>(`/ai-bid-analysis/tasks/${taskId}/progress`),

  // Requirements
  getRequirements: (taskId: string) =>
    fetchApi<TenderRequirements>(`/ai-bid-analysis/tasks/${taskId}/requirements`),

  // Report
  getReport: (taskId: string) =>
    fetchApi<AiBidReport>(`/ai-bid-analysis/tasks/${taskId}/report`),

  // Tender Files (多文件支持)
  uploadTenderFile: async (taskId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`上传失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean; fileName: string; isMain: boolean; tenderFileId: string }>;
  },

  getTenderFiles: async (taskId: string) => {
    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender-files`, {
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`获取失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<AiTenderFile[]>;
  },

  deleteTenderFile: async (taskId: string, fileId: string) => {
    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender-files/${fileId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`删除失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean }>;
  },

  setMainTenderFile: async (taskId: string, fileId: string) => {
    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender-files/${fileId}/set-main`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`设置失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean }>;
  },

  reparseTenderFile: async (taskId: string, fileId: string) => {
    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender-files/${fileId}/reparse`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`重新解析失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean; message: string }>;
  },

  // 清除所有招标文件
  clearAllTenderFiles: async (taskId: string) => {
    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/tender`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`删除失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean }>;
  },

  uploadBidderFile: async (taskId: string, bidderId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/bidders/${bidderId}/file`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`上传失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean; fileName: string }>;
  },

  // Import Bidder (upload + OCR + auto-name extraction)
  importBidder: async (taskId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${getApiBase()}/ai-bid-analysis/tasks/${taskId}/bidders/import`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`导入失败: ${res.status} - ${error}`);
    }

    return res.json() as Promise<{ success: boolean; bidder: AiBidder; extractedName: string }>;
  },

  // Update Bidder Name
  updateBidderName: (taskId: string, bidderId: string, name: string) =>
    fetchApi<{ success: boolean; bidder: AiBidder }>(
      `/ai-bid-analysis/tasks/${taskId}/bidders/${bidderId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }
    ),

  // Start Analysis
  startAnalysis: (taskId: string) =>
    fetchApi<{ success: boolean; bidderCount: number; message: string }>(
      `/ai-bid-analysis/tasks/${taskId}/start`,
      { method: 'POST' }
    ),

  // Cancel Analysis
  cancelAnalysis: (taskId: string) =>
    fetchApi<{ success: boolean; message: string }>(
      `/ai-bid-analysis/tasks/${taskId}/cancel`,
      { method: 'POST' }
    ),

  // Retry Bidder
  retryBidder: (taskId: string, bidderId: string) =>
    fetchApi<{ success: boolean; message: string }>(
      `/ai-bid-analysis/tasks/${taskId}/bidders/${bidderId}/retry`,
      { method: 'POST' }
    ),

  // Fraud Detection
  getFraudDetection: (taskId: string) =>
    fetchApi<FraudIndicators>(`/ai-bid-analysis/tasks/${taskId}/fraud-detection`),

  // Health Check
  checkHealth: () =>
    fetchApi<HealthStatus>('/ai-bid-analysis/health'),
};
