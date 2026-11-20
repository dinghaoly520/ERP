'use client';

/**
 * 供应商材料媒体展示（2026-11-20 用户裁定：材料不再收进「查看文件」按钮——
 * 全部信息与图片直接平铺展示，点击单独放大，支持旋转/缩放）
 * - 图片 → 内联缩略图，点击开灯箱（±90° 旋转 · 25%~400% 缩放 · 双击 100%↔200% · 新窗口原图）
 * - PDF 等文档 → 文件 chip，点击走既有 FilePreviewModal 窗口内预览
 * 类型判定与 file-preview-modal 同口径：名称扩展名优先；URL 无扩展名
 * （/api/upload/files/<cuid>）HEAD 探测 Content-Type；探测失败按图片试渲染，
 * img onError 回退 chip。走 :3005 proxy（同源 cookie 带登录态）。
 */

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { FilePreviewModal, kindFromName, type FilePreviewTarget } from './file-preview-modal';

export type PhotoTarget = { src: string; name: string } | null;

/* ── 灯箱：旋转 + 缩放（布局盒随「旋转包围盒 × 缩放」预留滚动范围——
 *    transform 不改变布局尺寸，须由包裹层撑出 overflow 滚动区）── */
export function PhotoViewer({ target, onClose }: { target: PhotoTarget; onClose: () => void }) {
  const [rotate, setRotate] = useState(0);
  const [scale, setScale] = useState(1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setRotate(0); setScale(1); setNatural(null); setFailed(false); }, [target]);

  if (!target) return null;

  const VIEW_W = 1180;
  const VIEW_H = 560;
  // 原始尺寸等比缩入视口（fit 阶段），旋转仅交换包围盒宽高，缩放作用于包围盒
  const fit = natural
    ? (() => {
      const k = Math.min(1, VIEW_W / natural.w, VIEW_H / natural.h);
      return { w: Math.round(natural.w * k), h: Math.round(natural.h * k) };
    })()
    : null;
  const rotated = fit
    ? (Math.abs(rotate % 180) === 90 ? { w: fit.h, h: fit.w } : { w: fit.w, h: fit.h })
    : null;
  const box = rotated ? { w: Math.round(rotated.w * scale), h: Math.round(rotated.h * scale) } : null;

  return (
    <Modal open onClose={onClose} title="图片查看" description={target.name} size="3xl"
      headerExtra={
        <>
          <button type="button" className="neu-btn-xs" aria-label="向左旋转 90 度" title="向左旋转 90°" onClick={() => setRotate(r => r - 90)}><RotateCcw size={13} /></button>
          <button type="button" className="neu-btn-xs" aria-label="向右旋转 90 度" title="向右旋转 90°" onClick={() => setRotate(r => r + 90)}><RotateCw size={13} /></button>
          <button type="button" className="neu-btn-xs" aria-label="缩小" title="缩小（最至 25%）" disabled={scale <= 0.25}
            onClick={() => setScale(s => Math.max(0.25, Math.round((s / 1.25) * 1000) / 1000))}><ZoomOut size={13} /></button>
          <span className="w-11 text-center font-mono text-[11px] font-bold tabular-nums text-[var(--muted-foreground)]">{Math.round(scale * 100)}%</span>
          <button type="button" className="neu-btn-xs" aria-label="放大" title="放大（最高 400%）" disabled={scale >= 4}
            onClick={() => setScale(s => Math.min(4, Math.round(s * 1.25 * 1000) / 1000))}><ZoomIn size={13} /></button>
          <button type="button" className="neu-btn-xs" title="恢复原始方向与大小"
            onClick={() => { setRotate(0); setScale(1); }}>重置</button>
          <a href={target.src} target="_blank" rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-[color:var(--border)] px-2.5 text-xs font-bold text-[var(--accent)] hover:bg-[color:var(--accent)]/8"
            title="新窗口打开原图"><ExternalLink size={12} /></a>
        </>
      }>
      <div className="flex min-h-[440px] flex-col overflow-hidden rounded-xl" style={{ background: 'oklch(0.55 0.03 258 / 0.06)' }}>
        {failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-bold text-[var(--foreground)]">图片加载失败</p>
            <p className="text-xs text-[var(--muted-foreground)]">可点右上角「新窗口打开」查看原图</p>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center overflow-auto p-3">
            <div className="flex shrink-0 items-center justify-center" style={box ? { width: box.w, height: box.h, margin: 'auto' } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 受控下载代理 URL，非静态资源 */}
              <img src={target.src} alt={target.name}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setFailed(true)}
                onDoubleClick={() => setScale(s => (s === 1 ? 2 : 1))}
                style={{
                  ...(fit ? { width: fit.w, height: fit.h } : { maxWidth: '100%', maxHeight: '58vh' }),
                  transform: `rotate(${rotate}deg) scale(${scale})`,
                  transformOrigin: 'center center',
                  borderRadius: 8,
                  cursor: 'zoom-in',
                  userSelect: 'none',
                }} />
            </div>
          </div>
        )}
      </div>
      <p className="text-center text-[10px] text-[var(--muted-foreground)]">双击图片在 100% / 200% 间切换 · 放大后可滚动查看局部</p>
    </Modal>
  );
}

/* ── 内联缩略图 / 文件 chip：自持预览状态（图片→灯箱；文档→FilePreviewModal）── */
type MediaKindState = 'loading' | 'image' | 'pdf' | 'file';

export function MediaThumb({ url, name, caption }: { url: string; name: string; caption?: string }) {
  const [kind, setKind] = useState<MediaKindState>('loading');
  const [photo, setPhoto] = useState<PhotoTarget>(null);
  const [doc, setDoc] = useState<FilePreviewTarget>(null);

  useEffect(() => {
    // kindFromName 返回类型含 iframe/unsupported（声明宽于实际返回），此处只认 image/pdf 两态
    const direct = kindFromName(name);
    if (direct === 'image' || direct === 'pdf') { setKind(direct); return; }
    let alive = true;
    setKind('loading');
    fetch(url, { method: 'HEAD' })
      .then(res => {
        if (!alive) return;
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('image/')) setKind('image');
        else if (ct.includes('pdf')) setKind('pdf');
        else setKind('file');
      })
      .catch(() => { if (alive) setKind('image'); }); // 探测失败按图片试渲染；img 加载失败再回退 chip
    return () => { alive = false; };
  }, [url, name]);

  const label = caption ?? name;

  return (
    <div className="flex flex-col items-center gap-1">
      {kind === 'loading' && (
        <div className="rc-skel shrink-0" style={{ width: 122, height: 86 }} aria-label="文件类型识别中" />
      )}
      {kind === 'image' && (
        <button type="button" onClick={() => setPhoto({ src: url, name })}
          className="group relative shrink-0 overflow-hidden rounded-[10px] transition-shadow focus:outline-none"
          style={{ width: 122, height: 86, border: '1px solid oklch(0.62 0.04 258 / 0.16)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.09)' }}
          title={`${label} · 点击放大（支持旋转/缩放）`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 受控下载代理 URL，非静态资源 */}
          <img src={url} alt={label} loading="lazy" onError={() => setKind('file')}
            className="h-full w-full object-cover" draggable={false} />
          <span className="absolute inset-0 flex items-center justify-center bg-[oklch(0.45_0.04_258/0.34)] opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 size={16} className="text-white" strokeWidth={1.9} />
          </span>
        </button>
      )}
      {(kind === 'pdf' || kind === 'file') && (
        <button type="button" onClick={() => setDoc({ src: url, name })}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-2.5 text-left text-[10px] font-bold text-[var(--accent)] hover:underline"
          style={{ width: 122, height: 86, background: 'oklch(1 0 0 / 0.55)', border: '1px solid oklch(0.62 0.04 258 / 0.14)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}
          title={`${label} · 点击窗口内预览`}>
          <FileText size={14} className="shrink-0" strokeWidth={1.8} />
          <span className="leading-tight line-clamp-2">{label}</span>
        </button>
      )}
      <span className="w-[122px] truncate text-center text-[10px] font-semibold text-[var(--muted-foreground)]" title={label}>{label}</span>

      {photo && <PhotoViewer target={photo} onClose={() => setPhoto(null)} />}
      <FilePreviewModal target={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
