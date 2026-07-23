"use client";

import { Download, Pencil, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteProjectAttachment } from "@/lib/api/project-management";
import type { ProjectManagementAttachment } from "@/lib/types/project-management";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    const url = `${API_BASE}/upload/files/${encodeURIComponent(file.objectKey)}`;
    window.open(url, '_blank');
  };

  const isDocx = (fileName: string) => fileName.toLowerCase().endsWith('.docx');

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div
          key={file.objectKey}
          className="neu-attachment-item group relative flex items-center gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
              {file.fileName}
            </div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              {file.mimeType} · {formatFileSize(file.fileSize)}
            </div>
          </div>
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
      ))}
    </div>
  );
}
