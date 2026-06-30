'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  FileSearch,
  Upload,
  Loader2,
  Play,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchKnowledgeBases } from '@/lib/api/knowledge';
import { uploadReviewDocument, executeReview, fetchReviewTask } from '@/lib/api/review';
import type { KnowledgeBase, ReviewMode } from '@/lib/types/tender-review';

export default function ReviewPanel() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [mode, setMode] = useState<ReviewMode>('strict');
  const [file, setFile] = useState<File | null>(null);
  const [executing, setExecuting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchKnowledgeBases().then(setKbs).catch(() => toast.error('加载知识库失败'));
  }, []);

  useEffect(() => {
    if (!taskId || taskStatus === 'completed' || taskStatus === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const task = await fetchReviewTask(taskId);
        setTaskStatus(task.status);
        if (task.status === 'completed') {
          clearInterval(interval);
          toast.success('审查完成，请切换到"审查报告"查看结果');
        } else if (task.status === 'failed') {
          clearInterval(interval);
          toast.error('审查失败，请重试');
        }
      } catch {
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [taskId, taskStatus]);

  async function handleExecute() {
    if (!selectedKb) {
      toast.error('请先选择知识库');
      return;
    }
    if (!file) {
      toast.error('请先上传待审文件');
      return;
    }
    setExecuting(true);
    setTaskId(null);
    setTaskStatus(null);
    try {
      const isLargePdf = file.name.toLowerCase().endsWith('.pdf') && file.size > 5 * 1024 * 1024;
      if (isLargePdf) {
        toast.info('正在解析文件（扫描件可能需要较长时间）...', { duration: 10000, id: 'upload-doc' });
      }
      const uploadResult = await uploadReviewDocument(file);
      toast.dismiss('upload-doc');
      const result = await executeReview({
        knowledgeBaseId: selectedKb,
        reviewMode: mode,
        documentContent: uploadResult.content,
        documentName: uploadResult.documentName,
        objectKey: uploadResult.objectKey,
      });
      setTaskId(result.taskId);
      setTaskStatus(result.status);
      toast.success('审查任务已提交');
    } catch (err) {
      const message = err instanceof Error ? err.message : '审查执行失败';
      toast.error(message);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold text-[var(--foreground)]">执行审查</h3>

      {/* KB Selector */}
      <div>
        <label className="text-sm text-[var(--muted-foreground)] mb-1.5 block">选择知识库</label>
        <select
          value={selectedKb}
          onChange={(e) => setSelectedKb(e.target.value)}
          className="w-full rounded-[12px] border border-gray-300 bg-white px-4 py-2.5 text-sm
            text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 appearance-none"
        >
          <option value="">选择知识库...</option>
          {kbs.map((kb) => (
            <option key={kb.id} value={kb.id}>{kb.name}</option>
          ))}
        </select>
      </div>

      {/* Mode Selection */}
      <div>
        <label className="text-sm text-[var(--muted-foreground)] mb-1.5 block">审查模式</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('strict')}
            className={`rounded-[16px] p-4 text-left border transition-all ${
              mode === 'strict'
                ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="font-medium text-sm text-[var(--foreground)]">严格审查</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">
              基于规则引擎逐项核对，精确度高
            </div>
          </button>
          <button
            onClick={() => setMode('general')}
            className={`rounded-[16px] p-4 text-left border transition-all ${
              mode === 'general'
                ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="font-medium text-sm text-[var(--foreground)]">通用审查</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">
              语义检索 + LLM 综合判断，快速初筛
            </div>
          </button>
        </div>
      </div>

      {/* File Upload */}
      <div>
        <label className="text-sm text-[var(--muted-foreground)] mb-1.5 block">上传待审文件</label>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".doc,.docx,.pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-[16px] border border-dashed border-white/15 p-6 text-center
            hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.03] transition-colors"
        >
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="h-5 w-5 text-[var(--accent)]" />
              <span className="text-sm text-[var(--foreground)]">{file.name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-[var(--muted-foreground)]">
              <Upload className="h-5 w-5" />
              <span className="text-sm">点击上传 DOCX 或 PDF 文件</span>
            </div>
          )}
        </button>
      </div>

      {/* Execute */}
      <button
        onClick={handleExecute}
        disabled={executing}
        className="w-full flex items-center justify-center gap-2 rounded-[16px] py-3 text-sm font-semibold
          bg-[var(--accent)] text-white hover:opacity-90 transition-opacity
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {executing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {executing ? '提交中...' : '开始审查'}
      </button>

      {/* Progress */}
      {taskId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-surface rounded-[16px] p-4 text-center"
        >
          {taskStatus === 'running' && (
            <div className="flex items-center justify-center gap-2 text-[var(--accent)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">审查进行中...</span>
            </div>
          )}
          {taskStatus === 'completed' && (
            <div className="text-[rgba(92,181,150,1)] text-sm font-medium">
              审查完成，请切换到"审查报告"查看结果
            </div>
          )}
          {taskStatus === 'failed' && (
            <div className="text-[rgba(230,129,102,1)] text-sm">审查失败，请重试</div>
          )}
        </motion.div>
      )}
    </div>
  );
}
