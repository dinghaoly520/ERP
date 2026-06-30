'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTenderReview } from './tender-review-context';
import { createKnowledgeBase, deleteKnowledgeBase, uploadKnowledgeFile, deleteKnowledgeFile, reindexKnowledgeBase } from '@/lib/api/knowledge';
import { uploadReviewDocument, executeReview, stopReviewTask, deleteReviewTask, fetchReviewTask } from '@/lib/api/review';
import { createRule, updateRule, deleteRule, extractRulesFromKb } from '@/lib/api/rules';
import type { ComplianceRule } from '@/lib/types/tender-review';

// Re-export the context hook for convenience
export { useTenderReview } from './tender-review-context';

// Knowledge base operations
export function useKnowledgeBaseOps() {
  const { refreshKnowledgeBases, selectedKbId, setSelectedKbId } = useTenderReview();

  const create = useCallback(async (name: string, description?: string) => {
    try {
      const kb = await createKnowledgeBase({ name, description });
      toast.success('知识库创建成功');
      await refreshKnowledgeBases();
      setSelectedKbId(kb.id);
      return kb;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases, setSelectedKbId]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteKnowledgeBase(id);
      toast.success('已删除');
      if (selectedKbId === id) {
        setSelectedKbId(null);
      }
      await refreshKnowledgeBases();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases, selectedKbId, setSelectedKbId]);

  const uploadFile = useCallback(async (kbId: string, file: File) => {
    try {
      await uploadKnowledgeFile(kbId, file);
      await refreshKnowledgeBases();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  const deleteFile = useCallback(async (kbId: string, fileId: string) => {
    try {
      await deleteKnowledgeFile(kbId, fileId);
      toast.success('文件已删除');
      await refreshKnowledgeBases();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  const reindex = useCallback(async (kbId: string) => {
    try {
      await reindexKnowledgeBase(kbId);
      toast.success('重建索引完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重建索引失败';
      toast.error(msg);
      throw err;
    }
  }, []);

  return {
    create,
    remove,
    uploadFile,
    deleteFile,
    reindex,
  };
}

// Review operations
export function useReviewOps() {
  const { refreshTasks, selectedKbId } = useTenderReview();

  const uploadDocument = useCallback(async (file: File) => {
    try {
      const result = await uploadReviewDocument(file);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传文档失败';
      toast.error(msg);
      throw err;
    }
  }, []);

  const startReview = useCallback(async (params: {
    knowledgeBaseId: string;
    reviewMode: 'strict' | 'general';
    documentContent: string;
    documentName: string;
    objectKey: string;
  }) => {
    try {
      const result = await executeReview(params);
      toast.success('审查任务已创建');
      await refreshTasks();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建审查任务失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshTasks]);

  const stopTask = useCallback(async (taskId: string) => {
    try {
      await stopReviewTask(taskId);
      toast.success('任务已停止');
      await refreshTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '停止任务失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshTasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteReviewTask(taskId);
      toast.success('任务已删除');
      await refreshTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除任务失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshTasks]);

  const getTask = useCallback(async (taskId: string) => {
    try {
      return await fetchReviewTask(taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取任务失败';
      toast.error(msg);
      throw err;
    }
  }, []);

  return {
    uploadDocument,
    startReview,
    stopTask,
    deleteTask,
    getTask,
    selectedKbId,
  };
}

// Rule operations
export function useRuleOps() {
  const { refreshKnowledgeBases } = useTenderReview();

  const create = useCallback(async (kbId: string, data: Omit<ComplianceRule, 'id' | 'knowledgeBaseId' | 'createdAt' | 'updatedAt'>) => {
    try {
      const rule = await createRule(kbId, data);
      toast.success('规则创建成功');
      await refreshKnowledgeBases();
      return rule;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建规则失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  const update = useCallback(async (ruleId: string, data: Partial<ComplianceRule>) => {
    try {
      const rule = await updateRule(ruleId, data);
      toast.success('规则更新成功');
      await refreshKnowledgeBases();
      return rule;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新规则失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  const remove = useCallback(async (ruleId: string) => {
    try {
      await deleteRule(ruleId);
      toast.success('规则已删除');
      await refreshKnowledgeBases();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除规则失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  const extractFromKb = useCallback(async (kbId: string) => {
    try {
      const result = await extractRulesFromKb(kbId);
      toast.success(`提取了 ${result.length} 条规则`);
      await refreshKnowledgeBases();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI提取规则失败';
      toast.error(msg);
      throw err;
    }
  }, [refreshKnowledgeBases]);

  return {
    create,
    update,
    remove,
    extractFromKb,
  };
}
