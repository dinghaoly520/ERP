"use client";

import { useEffect } from "react";
import { ExternalLink, FileQuestion, X } from "lucide-react";

/**
 * 注册流程文件窗口预览（2026-10-09）：
 * - 图片（png/jpg/jpeg/webp/gif）→ <img> 等比缩放；
 * - PDF → <iframe> 内嵌渲染（服务端 streamFile 为 Content-Disposition: inline）；
 * - 其余格式（word 等）→ 注册上传服务端仅放行 pdf/jpg/png，此处给不可预览提示 + 新窗口兜底。
 * 弹层复用 gdlg-*（与注册协议弹窗同一 neumorphic 语言）。
 */

export type FilePreviewTarget = { src: string; name: string } | null;

const IMAGE_RE = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const PDF_RE = /\.pdf(\?|$)/i;

function previewKind(name: string): "image" | "pdf" | "unsupported" {
  if (IMAGE_RE.test(name)) return "image";
  if (PDF_RE.test(name)) return "pdf";
  return "unsupported";
}

export function FilePreviewModal({ target, onClose }: { target: FilePreviewTarget; onClose: () => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;
  const kind = previewKind(target.name);

  return (
    <div className="gdlg-ov" role="dialog" aria-modal aria-label={`预览 ${target.name}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gdlg-pn !w-[min(920px,92vw)] !flex !flex-col" style={{ maxHeight: "86vh" }}>
        <div className="gdlg-h">
          <div className="gdlg-hl">
            <div>
              <h2 className="gdlg-t">文件预览</h2>
              <p className="mt-0.5 truncate text-[11px] text-[var(--reg-ink-muted, #64748b)]" style={{ maxWidth: 560 }}>{target.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <a href={target.src} target="_blank" rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-bold"
              style={{ background: "var(--surface, oklch(0.965 0.012 252))", color: "var(--sp-primary, #064ea2)" }}>
              <ExternalLink size={12} /> 新窗口打开
            </a>
            <button type="button" className="gdlg-x" onClick={onClose} aria-label="关闭">
              <X size={18} strokeWidth={1.85} />
            </button>
          </div>
        </div>
        <div className="gdlg-b !flex-1 !overflow-hidden" style={{ display: "flex", flexDirection: "column" }}>
          {kind === "image" && (
            <div className="flex flex-1 items-center justify-center overflow-auto rounded-xl"
              style={{ background: "oklch(0.55 0.03 258 / 0.06)", padding: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 预览本地 objectURL/受控外链，非静态资源 */}
              <img src={target.src} alt={target.name} style={{ maxWidth: "100%", maxHeight: "64vh", objectFit: "contain", borderRadius: 8 }} />
            </div>
          )}
          {kind === "pdf" && (
            <iframe src={target.src} title={target.name}
              style={{ flex: 1, width: "100%", minHeight: "56vh", border: "none", borderRadius: 12, background: "#fff" }} />
          )}
          {kind === "unsupported" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
              <FileQuestion size={28} className="text-[var(--reg-ink-muted, #94a3b8)]" />
              <p className="text-[13px] font-semibold" style={{ color: "var(--reg-ink, #1e293b)" }}>该格式暂不支持窗口内预览</p>
              <p className="text-[11px] text-[var(--reg-ink-muted, #64748b)]">支持 PNG / JPG / PDF；可点右上角「新窗口打开」下载查看</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
