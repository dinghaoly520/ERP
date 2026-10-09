'use client';

/**
 * 供应商审批中心 · 文件窗口预览（2026-10-09）
 *
 * 「查看文件/附件」原为新开标签页直连 /api/upload/files/:id；现改为窗口内预览：
 *  - 名称带扩展名 → 直接判定（图片 <img> / PDF <iframe>，服务端 streamFile 为 inline）
 *  - URL 无扩展名（资质 fileUrl 为 /api/upload/files/<cuid>）→ HEAD 探测 Content-Type
 *  - word 等浏览器不内嵌渲染的格式 → 提示 + 「新窗口打开」兜底
 * 走 :3005 proxy 中间件（显式 fetch + Cookie 透传），iframe/img 同站携带登录态。
 */

import { useEffect, useState } from 'react';
import { ExternalLink, FileQuestion, Loader2 } from 'lucide-react';
import { Modal } from '@/components/workbench';

export type FilePreviewTarget = { src: string; name: string } | null;

const IMAGE_RE = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const PDF_RE = /\.pdf(\?|$)/i;
type PreviewKind = 'image' | 'pdf' | 'iframe' | 'unsupported';

function kindFromName(name: string): PreviewKind | null {
  if (IMAGE_RE.test(name)) return 'image';
  if (PDF_RE.test(name)) return 'pdf';
  return null; // 名称无可用扩展 → 探测
}

export function FilePreviewModal({ target, onClose }: { target: FilePreviewTarget; onClose: () => void }) {
  const [kind, setKind] = useState<PreviewKind | 'loading'>('loading');

  useEffect(() => {
    if (!target) return;
    const direct = kindFromName(target.name);
    if (direct) { setKind(direct); return; }
    let alive = true;
    setKind('loading');
    // URL 无扩展名（cuid）：HEAD 探测 Content-Type；探测失败按 iframe 兜底（浏览器自行决定渲染/下载）
    fetch(target.src, { method: 'HEAD' })
      .then((res) => {
        if (!alive) return;
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('image/')) setKind('image');
        else if (ct.includes('pdf')) setKind('pdf');
        else if (/word|msword|officedocument|excel|sheet|zip|rar/.test(ct)) setKind('unsupported');
        else setKind('iframe');
      })
      .catch(() => { if (alive) setKind('iframe'); });
    return () => { alive = false; };
  }, [target]);

  if (!target) return null;

  return (
    <Modal open onClose={onClose} title="文件预览" description={target.name} size="2xl"
      className="!max-w-[min(960px,94vw)]"
      headerExtra={
        <a href={target.src} target="_blank" rel="noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[color:var(--border)] px-2.5 text-xs font-bold text-[var(--accent)] hover:bg-[color:var(--accent)]/8">
          <ExternalLink size={12} /> 新窗口打开
        </a>
      }>
      <div className="flex min-h-[54vh] flex-col overflow-hidden rounded-xl" style={{ background: 'oklch(0.55 0.03 258 / 0.06)' }}>
        {kind === 'loading' && (
          <div className="flex flex-1 items-center justify-center gap-2 py-20 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" /> 正在识别文件类型…
          </div>
        )}
        {kind === 'image' && (
          <div className="flex flex-1 items-center justify-center overflow-auto p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 预览受控下载代理 URL，非静态资源 */}
            <img src={target.src} alt={target.name} style={{ maxWidth: '100%', maxHeight: '64vh', objectFit: 'contain', borderRadius: 8 }} />
          </div>
        )}
        {(kind === 'pdf' || kind === 'iframe') && (
          <iframe src={target.src} title={target.name} style={{ flex: 1, width: '100%', minHeight: '58vh', border: 'none', borderRadius: 12, background: '#fff' }} />
        )}
        {kind === 'unsupported' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            <FileQuestion size={28} className="text-[var(--muted-foreground)]" />
            <p className="text-sm font-bold text-[var(--foreground)]">该格式暂不支持窗口内预览</p>
            <p className="text-xs text-[var(--muted-foreground)]">Word/Excel 等文档请点右上角「新窗口打开」下载查看</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
