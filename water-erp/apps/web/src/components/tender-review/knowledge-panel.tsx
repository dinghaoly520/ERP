'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  Database,
  FileText,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  uploadKnowledgeFile,
  deleteKnowledgeFile,
  reindexKnowledgeBase,
} from '@/lib/api/knowledge';
import type { KnowledgeBase } from '@/lib/types/tender-review';

export default function KnowledgePanel() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newKbId, setNewKbId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  useEffect(() => {
    loadKbs();
  }, []);

  async function loadKbs() {
    try {
      const data = await fetchKnowledgeBases();
      setKbs(data);
    } catch {
      toast.error('加载知识库失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const kb = await createKnowledgeBase({ name: newName.trim(), description: newDesc.trim() || undefined });
      toast.success('知识库创建成功');
      setNewKbId(kb.id);
      loadKbs();
    } catch {
      toast.error('创建失败');
    }
  }

  function closeCreate() {
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    setNewKbId(null);
  }

  async function handleDelete(id: string) {
    try {
      await deleteKnowledgeBase(id);
      toast.success('已删除');
      setDeleteConfirmId(null);
      loadKbs();
    } catch (err) {
      console.error('删除知识库失败:', err);
      toast.error('删除失败');
    }
  }

  async function handleUpload(kbId: string, files: FileList | null) {
    if (!files?.length) return;
    setUploading(kbId);
    const total = files.length;
    const fileNames: string[] = [];

    try {
      for (let i = 0; i < total; i++) {
        const file = files[i];
        fileNames.push(file.name);
        const isLargePdf = file.name.toLowerCase().endsWith('.pdf') && file.size > 5 * 1024 * 1024;
        const msg = isLargePdf
          ? `正在处理文件 (${i + 1}/${total})：${file.name}（扫描件可能需要较长时间）`
          : `正在处理文件 (${i + 1}/${total})：${file.name}`;
        toast.info(msg, { duration: 8000, id: 'upload-progress' });
        await uploadKnowledgeFile(kbId, file);
      }
      toast.success(`${total} 个文件上传并索引完成`, { id: 'upload-progress' });
      loadKbs();
    } catch (err) {
      console.error('Upload error:', err);
      toast.error(`文件处理失败：${err instanceof Error ? err.message : '请重试'}`, { id: 'upload-progress' });
    } finally {
      setUploading(null);
    }
  }

  async function handleDeleteFile(kbId: string, fileId: string) {
    try {
      await deleteKnowledgeFile(kbId, fileId);
      toast.success('文件已删除');
      loadKbs();
    } catch (err) {
      console.error('Delete file error:', err);
      toast.error(`删除文件失败：${err instanceof Error ? err.message : '请重试'}`);
    }
  }

  async function handleReindex(kbId: string) {
    try {
      await reindexKnowledgeBase(kbId);
      toast.success('重建索引完成');
      loadKbs();
    } catch {
      toast.error('重建索引失败');
    }
  }

  function startFileUpload(kbId: string) {
    console.log('startFileUpload called with kbId:', kbId);
    setUploadTarget(kbId);
    setTimeout(() => {
      console.log('fileInputRef.current:', fileInputRef.current);
      fileInputRef.current?.click();
    }, 0);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
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
        onChange={(e) => uploadTarget && handleUpload(uploadTarget, e.target.files)}
      />

      {/* Create new KB */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">知识库列表</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium
            bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
        >
          <Plus className="h-4 w-4" />
          新建知识库
        </button>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-surface rounded-[20px] p-5 space-y-3"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="知识库名称"
            disabled={!!newKbId}
            className="w-full rounded-[12px] border border-gray-300 bg-white/5 px-4 py-2.5 text-sm
              text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--accent)]/50 disabled:opacity-50"
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="描述（可选）"
            rows={2}
            disabled={!!newKbId}
            className="w-full rounded-[12px] border border-gray-300 bg-white/5 px-4 py-2.5 text-sm
              text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--accent)]/50 resize-none disabled:opacity-50"
          />
          {newKbId ? (
            <div className="space-y-3">
              <div className="text-sm text-[var(--muted-foreground)]">
                知识库已创建，可上传文件或关闭
              </div>
              {(() => {
                const kb = kbs.find((k) => k.id === newKbId);
                if (kb?.files && kb.files.length > 0) {
                  return (
                    <div className="rounded-xl border border-gray-200 bg-white/[0.02] p-3 space-y-1">
                      <div className="text-xs text-[var(--muted-foreground)] mb-1">已上传 {kb.files.length} 个文件：</div>
                      {kb.files.map((file) => (
                        <div key={file.id} className="flex items-center justify-between gap-2 text-xs text-[var(--foreground)]">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                            <span className="truncate">{file.fileName}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteFile(kb.id, file.id)}
                            className="text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] transition-colors shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              })()}
              <div className="flex gap-2">
                <button
                  onClick={() => startFileUpload(newKbId)}
                  disabled={uploading === newKbId}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                >
                  {uploading === newKbId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  上传文件
                </button>
                <button
                  onClick={closeCreate}
                  className="rounded-xl px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  完成
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="rounded-xl px-5 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                创建
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl px-5 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                取消
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* KB List */}
      {kbs.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>暂无知识库，请先创建</p>
        </div>
      ) : (
        <div className="space-y-3">
          {kbs.map((kb) => (
            <div key={kb.id} className="panel-surface rounded-[20px] overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === kb.id ? null : kb.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-[var(--accent)]" />
                  <div className="text-left">
                    <div className="font-medium text-[var(--foreground)]">{kb.name}</div>
                    {kb.description && (
                      <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                        {kb.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {kb._count.files} 文件 · {kb._count.rules} 规则
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 text-[var(--muted-foreground)] transition-transform ${
                      expandedId === kb.id ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </button>

              {expandedId === kb.id && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  className="border-t border-white/5"
                >
                  <div className="p-4 space-y-3">
                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => startFileUpload(kb.id)}
                        disabled={uploading === kb.id}
                        className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
                          bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                      >
                        {uploading === kb.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        上传文件
                      </button>
                      <button
                        onClick={() => handleReindex(kb.id)}
                        className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
                          bg-white/5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        重建索引
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(kb.id)}
                        className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
                          bg-[rgba(230,129,102,0.1)] text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.2)] transition-colors ml-auto"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除知识库
                      </button>
                    </div>

                    {/* Delete Confirmation */}
                    {deleteConfirmId === kb.id && (
                      <div className="flex items-center gap-2 p-3 rounded-[14px] bg-[rgba(230,129,102,0.1)] border border-[rgba(230,129,102,0.2)]">
                        <span className="text-sm text-[rgba(230,129,102,1)]">确定删除？所有文件和规则将被删除。</span>
                        <button
                          onClick={() => handleDelete(kb.id)}
                          className="px-3 py-1 text-xs font-medium bg-[rgba(230,129,102,1)] text-white rounded-[8px] hover:bg-[rgba(210,110,90,1)]"
                        >
                          确认删除
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-3 py-1 text-xs font-medium bg-white/10 rounded-[8px] hover:bg-white/20"
                        >
                          取消
                        </button>
                      </div>
                    )}

                    {/* Files */}
                    {kb.files && kb.files.length > 0 ? (
                      <div className="space-y-1">
                        {kb.files.map((file) => (
                          <div
                            key={file.id}
                            className="flex items-center justify-between rounded-[12px] px-3 py-2 bg-white/[0.02]"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
                              <span className="text-sm text-[var(--foreground)]">
                                {file.fileName}
                              </span>
                              <span className="text-xs text-[var(--muted-foreground)]">
                                {file.chunkCount} 块
                              </span>
                            </div>
                            <button
                              onClick={() => handleDeleteFile(kb.id, file.id)}
                              className="text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--muted-foreground)] py-2">
                        暂无文件，点击上方"上传文件"添加
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
