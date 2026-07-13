'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  Loader2,
  FileText,
  Trash2,
  RefreshCw,
  Database,
  Shield,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTenderReview, useKnowledgeBaseOps } from './use-tender-review';

export default function FilesPanelCompact() {
  const { selectedKbId, knowledgeBases, refreshKnowledgeBases, setActiveTab } = useTenderReview();
  const { uploadFile, deleteFile, reindex } = useKnowledgeBaseOps();
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [showRuleTip, setShowRuleTip] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length || !selectedKbId) return;
    setUploading(true);
    const total = files.length;
    try {
      for (let i = 0; i < total; i++) {
        const file = files[i];
        const isLargePdf = file.name.toLowerCase().endsWith('.pdf') && file.size > 5 * 1024 * 1024;
        const msg = isLargePdf
          ? `正在处理文件 (${i + 1}/${total})：${file.name}（扫描件可能需要较长时间）`
          : `正在处理文件 (${i + 1}/${total})：${file.name}`;
        toast.info(msg, { duration: 8000, id: 'upload-progress' });
        await uploadFile(selectedKbId, file);
      }
      toast.success(`${total} 个文件上传并索引完成`, { id: 'upload-progress' });

      // 刷新知识库数据后检查是否需要提示用户提取规则
      await refreshKnowledgeBases();

      // 检查当前知识库是否有规则
      const kb = knowledgeBases.find(k => k.id === selectedKbId);
      if (kb && kb._count.rules === 0) {
        setShowRuleTip(true);
      }
    } catch (err) {
      toast.error(`文件处理失败：${err instanceof Error ? err.message : '请重试'}`, { id: 'upload-progress' });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!selectedKbId) return;
    try {
      await deleteFile(selectedKbId, fileId);
      refreshKnowledgeBases();
    } catch (err) {
      console.error('Delete file error:', err);
    }
  };

  const handleReindex = async () => {
    if (!selectedKbId) return;
    setReindexing(true);
    try {
      await reindex(selectedKbId);
    } catch (err) {
      console.error('Reindex error:', err);
    } finally {
      setReindexing(false);
    }
  };

  if (!selectedKbId || !selectedKb) {
    return (
      <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
        <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
        请从右侧选择知识库
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".doc,.docx,.pdf,.txt,.md,.jpg,.jpeg,.png,.tif,.tiff"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* KB Info Header */}
      <div className="flex items-center gap-3 p-3 rounded-[14px]" style={{background:"color-mix(in oklch,var(--accent-soft) 30%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 4px oklch(0.55 0.03 258 / 0.06)"}}>
        <Database className="h-5 w-5 text-[var(--accent)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">{selectedKb.name}</div>
          {selectedKb.description && (
            <div className="text-xs text-[var(--muted-foreground)] truncate">{selectedKb.description}</div>
          )}
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          {selectedKb._count.files} 文件
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-medium
            neu-btn-primary !rounded-[12px] !h-[40px]"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {uploading ? '上传中...' : '上传文件'}
        </button>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-medium
            neu-btn-soft !rounded-[12px] !h-[40px]"
        >
          {reindexing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          重建索引
        </button>
      </div>

      {/* Supported formats */}
      <div className="text-xs text-[var(--muted-foreground)]">
        支持格式：DOC、DOCX、PDF、TXT、MD、JPG、PNG、TIF
      </div>

      {/* Rule extraction tip */}
      {showRuleTip && selectedKb && selectedKb._count.rules === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-3 rounded-[12px] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]"
        >
          <Shield className="h-5 w-5 text-[rgba(234,188,110,1)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[rgba(234,188,110,1)]">尚未配置审查规则</div>
            <div className="text-xs text-[rgba(234,188,110,1)]/70">上传文件后可使用 AI 自动提取规则</div>
          </div>
          <button
            onClick={() => {
              setShowRuleTip(false);
              setActiveTab('rules');
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-medium
              bg-[rgba(234,188,110,0.2)] text-[rgba(234,188,110,1)] hover:bg-[rgba(234,188,110,0.3)] transition-colors shrink-0"
          >
            前往提取
            <ArrowRight className="h-3 w-3" />
          </button>
        </motion.div>
      )}

      {/* File list */}
      {selectedKb.files && selectedKb.files.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">已上传文件</div>
          <div className="space-y-1.5">
            {selectedKb.files.map((file) => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 p-3 rounded-[12px] hover:bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileText className="h-5 w-5 text-[var(--accent)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--foreground)] truncate">{file.fileName}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--muted-foreground)]">
                      <span>{(file.fileSize / 1024).toFixed(1)} KB</span>
                      <span>·</span>
                      <span>{file.chunkCount} 个文本块</span>
                      <span>·</span>
                      <span>{new Date(file.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFile(file.id)}
                  className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.12)] transition-colors shrink-0"
                  title="删除文件"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-[var(--muted-foreground)]">
          <Upload className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无文件</p>
          <p className="text-xs mt-1">点击"上传文件"添加文档</p>
        </div>
      )}
    </div>
  );
}