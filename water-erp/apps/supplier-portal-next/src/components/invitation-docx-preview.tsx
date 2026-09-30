"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { fetchAuthedFile, downloadAuthedFile } from "@/lib/authed-file";

/**
 * 采购邀请书 DOCX 在线预览（移植 :3005 stage-file-list 的 docx-preview 模式）。
 * - fetch（cookie + 本 tab X-Supplier-Token，B1-2）→ renderAsync 渲染公文原文
 * - 清理 docx 内嵌 @font-face 字体子集（缺字劫持系统字体 → 画成空白），回退系统 CJK 字体
 */
export function InvitationDocxPreview({ url, fileName }: { url: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        // B1-2（2026-09-30）：仅凭 cookie 时同浏览器他 tab 登录会以新身份取文件 → 403
        const blob = await fetchAuthedFile(url);
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(buffer, container, undefined, {
          inWrapper: true,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        // 移除 docx 内嵌 @font-face（无 unicode-range 的子集会劫持字形画成空白），回退系统字体
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRule[];
          try { rules = Array.from(sheet.cssRules); } catch { continue; }
          const kept = rules.filter((r) => !(r instanceof CSSFontFaceRule));
          if (kept.length === rules.length) continue;
          const owner = sheet.ownerNode;
          if (owner instanceof HTMLStyleElement) owner.textContent = kept.map((r) => r.cssText).join("\n");
        }
        if (!cancelled) setLoading(false);
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || "预览加载失败"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  async function download() {
    try {
      await downloadAuthedFile(url, fileName || "采购邀请书.docx");
    } catch { /* 全局层提示 */ }
  }

  return (
    <div className="cc-inv-docx">
      <div className="cc-inv-docx-bar">
        <span className="cc-inv-badge">采购邀请书</span>
        <span className="cc-inv-docx-name">{fileName}</span>
        <button type="button" className="neu-btn-xs" onClick={download}>
          <Download size={13} />下载 Word
        </button>
      </div>
      <div className="cc-inv-docx-stage">
        <div ref={containerRef} className="docx-render" />
        {loading && (
          <div className="cc-inv-docx-mask"><Loader2 size={18} className="animate-spin" /> 邀请书加载中…</div>
        )}
        {error && !loading && (
          <div className="cc-inv-docx-mask">
            <TriangleAlert size={16} /> {error}
            <button type="button" className="neu-btn-xs ml-3" onClick={download}>直接下载</button>
          </div>
        )}
      </div>
    </div>
  );
}
