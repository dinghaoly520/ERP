"use client";

import { Download, Eye, Pencil, X, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteProjectAttachment } from "@/lib/api/project-management";
import type { ProjectManagementAttachment } from "@/lib/types/project-management";
import { FilePreviewPane, attachmentFileUrl, getFileKind } from "./file-preview-pane";;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileKindIcon({ kind }: { kind: 'docx' | 'pdf' | 'image' | 'other' }) {
  if (kind === 'image') return <ImageIcon size={15} className="text-[var(--blue)]" />;
  if (kind === 'docx' || kind === 'pdf') return <FileText size={15} className="text-[var(--accent)]" />;
  return <FileIcon size={15} className="text-[var(--muted-foreground)]" />;
}

/* ── 文件预览弹窗（2026-09-26 预览内容抽为 FilePreviewPane，与本文件 Modal 壳解耦） ── */

function FilePreviewModal({
  projectId,
  file,
  onClose,
}: {
  projectId: string;
  file: ProjectManagementAttachment;
  onClose: () => void;
}) {
  const fileUrl = attachmentFileUrl(projectId, file);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[520] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' }}
            >
              <Eye size={16} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">{file.fileName}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{file.mimeType} · {formatFileSize(file.fileSize)}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.open(fileUrl, '_blank')}
              title="下载文件"
              className="neu-btn-xs"
            >
              <Download size={13} />
              下载
            </button>
            <button type="button" onClick={onClose} className="neu-btn-xs !p-1.5" title="关闭（Esc）">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 内容区（FilePreviewPane 自带 docx 缩放控件；overflow-auto 面板内部自理） */}
        <div className="min-h-0 flex-1">
          <FilePreviewPane projectId={projectId} file={file} />
        </div>
      </div>
    </div>
  );
}

/* ── 阶段文件列表 ─────────────────────────────────────────────── */

export function StageFileList({
  files,
  projectId,
  onDeleted,
  onEdit,
}: {
  files: ProjectManagementAttachment[];
  projectId: string;
  onDeleted?: (deletedObjectKey: string) => void;
  onEdit?: (attachmentId: string, fileName: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<ProjectManagementAttachment | null>(null);

  if (files.length === 0) {
    return (
      <div className="neu-surface px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
        当前阶段还没有上传文件。
      </div>
    );
  }

  const handleDelete = async (attachmentId: string, objectKey: string) => {
    if (!attachmentId) return;
    setDeletingId(attachmentId);
    setConfirmDeleteId(null);
    try {
      await deleteProjectAttachment(projectId, attachmentId);
      onDeleted?.(objectKey);
      toast.success('文件已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除文件失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (file: ProjectManagementAttachment) => {
    const url = file.id
      ? `${API_BASE}/project-management/${projectId}/attachment-file/${file.id}`
      : `${API_BASE}/upload/files/${encodeURIComponent(file.objectKey)}`;
    window.open(url, '_blank');
  };

  const isDocx = (fileName: string) => fileName.toLowerCase().endsWith('.docx');

  return (
    <>
      <div className="space-y-2">
        {files.map((file) => {
          const kind = getFileKind(file.fileName);
          return (
            <div
              key={file.objectKey}
              className="neu-attachment-item group relative flex items-center gap-3"
            >
              <button
                type="button"
                onClick={() => setPreviewFile(file)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                title="点击预览文件"
              >
                <FileKindIcon kind={kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[color:var(--foreground)] group-hover:text-[var(--accent)] transition-colors">
                    {file.fileName}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {file.mimeType} · {formatFileSize(file.fileSize)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPreviewFile(file)}
                className="neu-btn-xs !p-1.5 opacity-0 transition group-hover:opacity-100"
                title="查看文件"
              >
                <Eye size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleDownload(file)}
                className="neu-btn-xs !p-1.5 opacity-0 transition group-hover:opacity-100"
                title="下载文件"
              >
                <Download size={13} />
              </button>
              {file.id && isDocx(file.fileName) && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(file.id!, file.fileName)}
                  className="neu-btn-xs is-info !p-1.5 opacity-0 transition group-hover:opacity-100"
                  title="编辑修改"
                >
                  <Pencil size={13} />
                </button>
              )}
              {file.id && (
                confirmDeleteId === file.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleDelete(file.id!, file.objectKey)}
                      disabled={deletingId === file.id}
                      className="neu-btn-xs is-danger"
                    >
                      {deletingId === file.id ? '删除中…' : '确认删除'}
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} className="neu-btn-xs">取消</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(file.id!)}
                    className="neu-btn-xs is-danger !p-1.5 opacity-0 transition group-hover:opacity-100"
                    title="删除文件"
                  >
                    <X size={14} />
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {previewFile && (
        <FilePreviewModal
          projectId={projectId}
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
