"use client";

/**
 * 嵌入式文件预览面板（2026-09-26 从 stage-file-list FilePreviewModal 抽出）：
 * docx 高保真渲染（docx-preview）+ PDF iframe + 图片 + 其他类型占位。
 * 撑满父容器（h-full），供全屏预览 Modal 与「03 完成向导」左栏共用。
 */
import { FileText, Loader2, ZoomIn, ZoomOut, File as FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectManagementAttachment } from "@/lib/types/project-management";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export function attachmentFileUrl(projectId: string, file: ProjectManagementAttachment): string {
  // 项目阶段附件用专用端点按 attachmentId 提供文件（/upload/files/:id 按 FileAsset cuid 查找，objectKey 无法命中）
  return file.id
    ? `${API_BASE}/project-management/${projectId}/attachment-file/${file.id}`
    : `${API_BASE}/upload/files/${encodeURIComponent(file.objectKey)}`;
}

export function getFileKind(fileName: string): 'docx' | 'pdf' | 'image' | 'other' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return 'image';
  return 'other';
}

export function FilePreviewPane({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectManagementAttachment;
}) {
  const kind = getFileKind(file.fileName);
  const fileUrl = attachmentFileUrl(projectId, file);

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

  const zoomStep = (d: number) => setZoom(z => Math.min(2, Math.max(0.5, Math.round((z + d) * 100) / 100)));

  return (
    <div className="relative h-full min-h-0 w-full overflow-auto"
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
          {/* DOCX 缩放控件（浮动右上，不占布局） */}
          {!loading && !loadError && (
            <div
              className="sticky top-2 z-20 ml-auto mr-2 flex w-fit items-center gap-0.5 rounded-[9px] px-1 py-0.5"
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
          <div className="docx-preview-host py-4" style={{ zoom }}>
            <div ref={docxContainerRef} />
          </div>
        </div>
      ) : kind === 'pdf' ? (
        <iframe src={fileUrl} title={file.fileName} className="h-full min-h-[300px] w-full" />
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
  );
}
