"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { deleteProjectAttachment } from "@/lib/api/project-management";
import type { ProjectManagementAttachment } from "@/lib/types/project-management";

export function StageFileList({
  files,
  projectId,
  onDeleted,
}: {
  files: ProjectManagementAttachment[];
  projectId: string;
  onDeleted?: (deletedObjectKey: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (files.length === 0) {
    return (
      <div className="rounded-2xl bg-[rgba(246,249,253,0.55)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
        当前阶段还没有上传文件。
      </div>
    );
  }

  const handleDelete = async (attachmentId: string, objectKey: string) => {
    if (!attachmentId) return;

    setDeletingId(attachmentId);
    try {
      await deleteProjectAttachment(projectId, attachmentId);
      onDeleted?.(objectKey);
    } catch (error) {
      console.error("删除文件失败:", error);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div
          key={file.objectKey}
          className="group relative flex items-center gap-3 rounded-2xl bg-[rgba(246,249,253,0.65)] px-4 py-3 transition hover:bg-[rgba(240,245,252,0.8)]"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
              {file.fileName}
            </div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              {file.mimeType} · {file.fileSize} bytes
            </div>
          </div>
          {file.id && (
            <button
              type="button"
              onClick={() => handleDelete(file.id!, file.objectKey)}
              disabled={deletingId === file.id}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-[color:var(--muted-foreground)] opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="删除文件"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
