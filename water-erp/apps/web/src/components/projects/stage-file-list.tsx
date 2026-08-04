"use client";

import { Download, Eye, Loader2, Pencil, X, ZoomIn, ZoomOut, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteProjectAttachment } from "@/lib/api/project-management";
import type { ProjectManagementAttachment } from "@/lib/types/project-management";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileKind(fileName: string): 'docx' | 'pdf' | 'image' | 'other' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return 'image';
  return 'other';
}

function FileKindIcon({ kind }: { kind: 'docx' | 'pdf' | 'image' | 'other' }) {
  if (kind === 'image') return <ImageIcon size={15} className="text-[var(--blue)]" />;
  if (kind === 'docx' || kind === 'pdf') return <FileText size={15} className="text-[var(--accent)]" />;
  return <FileIcon size={15} className="text-[var(--muted-foreground)]" />;
}

/* ── 文件预览弹窗 ─────────────────────────────────────────────── */

function FilePreviewModal({
  projectId,
  file,
  onClose,
}: {
  projectId: string;
  file: ProjectManagementAttachment;
  onClose: () => void;
}) {
  const kind = getFileKind(file.fileName);
  // 项目阶段附件用专用端点按 attachmentId 提供文件（/upload/files/:id 按 FileAsset cuid 查找，objectKey 无法命中）
  const fileUrl = file.id
    ? `${API_BASE}/project-management/${projectId}/attachment-file/${file.id}`
    : `${API_BASE}/upload/files/${encodeURIComponent(file.objectKey)}`;

  // DOCX 高保真渲染（docx-preview：保留字体/字号/颜色/对齐/表格/分页）
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (kind !== 'docx') return;
    if (!file.id) { setLoadError('缺少附件 ID'); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const res = await fetch(fileUrl, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const container = docxContainerRef.current;
        if (!container) return;
        container.innerHTML = '';
        // 动态导入避免 SSR 触碰 DOM；useBase64URL 将图片内嵌为 dataURL
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        await renderAsync(buffer, container, undefined, {
          inWrapper: true,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        // docx-preview 会把 docx 内嵌的字体子集以 @font-face（无 unicode-range）注入全局，
        // 子集缺的字形（如 携/液/压/岩/钻/型）会"劫持"系统字体后画成空白。预览在用户本机渲染，
        // 系统自带完整 CJK 字体，故移除这些内嵌 @font-face，回退到系统字体，缺字即消失。
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRule[];
          try { rules = Array.from(sheet.cssRules); } catch { continue; }
          const kept = rules.filter((r) => !(r instanceof CSSFontFaceRule));
          if (kept.length === rules.length) continue;
          const owner = sheet.ownerNode;
          if (owner instanceof HTMLStyleElement) owner.textContent = kept.map((r) => r.cssText).join('\n');
        }
        // 浏览器对 CJK 的 text-align:justify 会产生 Word 不会有的大字距空隙；
        // 仅把"两端对齐"段落降级为左对齐，保留居中/右对齐标题的原样。
        container.querySelectorAll<HTMLElement>('p').forEach((p) => {
          if (getComputedStyle(p).textAlign === 'justify') p.style.textAlign = 'left';
        });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '文档解析失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, fileUrl, file.id]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomStep = (d: number) => setZoom(z => Math.min(2, Math.max(0.5, Math.round((z + d) * 100) / 100)));

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
            {/* DOCX 缩放控件 */}
            {kind === 'docx' && !loading && !loadError && (
              <div
                className="flex items-center gap-0.5 rounded-[9px] px-1 py-0.5"
                style={{ background: 'oklch(0.98 0.005 258)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 1px 3px oklch(0.55 0.03 258 / 0.1), -1px -1px 2px oklch(1 0 0 / 0.8)' }}
              >
                <button type="button" onClick={() => zoomStep(-0.1)} title="缩小"
                  className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--accent)] active:shadow-[inset_1px_1px_2px_oklch(0.55_0.03_258_/_0.14)]">
                  <ZoomOut size={13} />
                </button>
                <span className="w-10 text-center text-[10px] font-semibold tabular-nums text-[var(--foreground)]">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => zoomStep(0.1)} title="放大"
                  className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--accent)] active:shadow-[inset_1px_1px_2px_oklch(0.55_0.03_258_/_0.14)]">
                  <ZoomIn size={13} />
                </button>
              </div>
            )}
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

        {/* 内容区（overflow-auto：docx 页面定宽，窄屏需横向滚动） */}
        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)' }}
        >
          {kind === 'docx' ? (
            <div className="relative">
              {/* docx-preview 容器需常驻 DOM，renderAsync 才能写入；加载/错误态叠加在其上 */}
              {loading && (
                <div
                  className="absolute inset-0 z-10 flex min-h-[300px] items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]"
                  style={{ background: 'oklch(0.975 0.012 258 / 0.6)' }}
                >
                  <Loader2 size={18} className="animate-spin text-[var(--accent)]" />
                  正在解析文档内容…
                </div>
              )}
              {!loading && loadError && (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-sm text-[var(--danger)]">
                  <FileText size={28} className="text-[var(--muted-foreground)]" />
                  文档解析失败（{loadError}），请尝试下载后查看
                </div>
              )}
              <div className="docx-preview-host py-4" style={{ zoom }}>
                <div ref={docxContainerRef} />
              </div>
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={fileUrl} title={file.fileName} className="h-full w-full min-h-[500px]" />
          ) : kind === 'image' ? (
            <div className="flex min-h-[300px] items-center justify-center p-6">
              <img
                src={fileUrl}
                alt={file.fileName}
                className="max-h-[75vh] max-w-full rounded-[4px]"
                style={{ boxShadow: '0 2px 12px oklch(0.4 0.04 258 / 0.2)' }}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-sm text-[var(--muted-foreground)]">
              <FileIcon size={36} />
              该文件类型暂不支持在线预览，请下载后查看
            </div>
          )}
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
