'use client';

import { useImperativeHandle, useRef, forwardRef, useCallback } from 'react';

export interface AtramentCanvasHandle {
  clear: () => void;  toBlob: () => Promise<Blob | null>;  isEmpty: () => boolean;
  undo: () => void;  setMode: (m: 'draw' | 'erase') => void;  getMode: () => 'draw' | 'erase';
  setColor: (c: string) => void;  getColor: () => string;
  setWeight: (w: number) => void;  getWeight: () => number;
}

interface Props {
  width?: number; height?: number; strokeColor?: string; baseWeight?: number;
  className?: string;  onDirtyChange?: (dirty: boolean) => void;
}

interface Point { x: number; y: number; pressure: number }

/** 半宽（pressure → 半径）。压感灵敏 + 最小宽度保证可见 */
function halfW(pv: number, baseW: number): number {
  return Math.max(1.2, baseW * (0.25 + 0.75 * Math.pow(pv, 1.6))) / 2;
}

/** 逐 pair 画填充四边形 + 节点圆。每段用自己的压力→宽，一笔之内轻重粗细实时变化 */
function drawPath(ctx: CanvasRenderingContext2D, pts: Point[], baseW: number) {
  if (pts.length < 2) {
    if (pts.length === 1) {
      const r = halfW(pts[0].pressure, baseW);
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }
  // 起点圆
  {
    const r = halfW(pts[0].pressure, baseW);
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.02) continue;
    const nx = -dy / len, ny = dx / len;
    const ra = halfW(a.pressure, baseW), rb = halfW(b.pressure, baseW);
    // 四边形
    ctx.beginPath();
    ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
    ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
    ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
    ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
    ctx.closePath(); ctx.fill();
    // 节点圆
    ctx.beginPath(); ctx.arc(b.x, b.y, rb, 0, Math.PI * 2); ctx.fill();
  }
}

export const AtramentCanvas = forwardRef<AtramentCanvasHandle, Props>(
  ({ width = 400, height = 280, strokeColor = '#1e3a5f', baseWeight = 6, className = '', onDirtyChange },
   ref) => {
    // Retina：内部分辨率 = 逻辑尺寸 × DPR，ctx.scale(dpr) 让坐标保持逻辑像素
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2;
    const iw = Math.round(width * dpr);
    const ih = Math.round(height * dpr);

    const visRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLCanvasElement | null>(null);
    const bgCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const visCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const snapshots = useRef<string[]>([]);
    const hasDrawn = useRef(false);
    const drawing = useRef(false);
    const pathPts = useRef<Point[]>([]);
    const color = useRef(strokeColor);
    const weight = useRef(baseWeight);
    const mode = useRef<'draw' | 'erase'>('draw');

    const toLocal = (e: PointerEvent): Point => {
      const c = visRef.current!; const r = c.getBoundingClientRect();
      const pv = e.pressure;
      return { x: (e.clientX - r.left)*(width/r.width), y: (e.clientY - r.top)*(height/r.height),
               pressure: (pv > 0 && pv <= 1) ? pv : 0.5 };
    };

    const redraw = () => {
      const vc = visCtxRef.current; const bg = bgRef.current;
      if (!vc || !bg) return;
      vc.save(); vc.setTransform(dpr, 0, 0, dpr, 0, 0);
      vc.clearRect(0, 0, width, height);
      vc.drawImage(bg, 0, 0);
      vc.restore();
      vc.fillStyle = color.current;
      vc.globalCompositeOperation = mode.current === 'erase' ? 'destination-out' : 'source-over';
      drawPath(vc, pathPts.current, weight.current);
    };

    const md = (d: boolean) => { hasDrawn.current = d; onDirtyChange?.(d); };

    // 异步快照（撤销用）
    const snap = () => {
      const c = visRef.current; if (!c) return;
      requestAnimationFrame(() => { try { snapshots.current.push(c.toDataURL()); } catch {} });
    };

    const commitToBg = () => {
      const bgCtx = bgCtxRef.current;
      if (!bgCtx) return;
      bgCtx.globalCompositeOperation = mode.current === 'erase' ? 'destination-out' : 'source-over';
      bgCtx.strokeStyle = color.current;
      bgCtx.fillStyle = color.current;
      drawPath(bgCtx, pathPts.current, weight.current);
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const v = visRef.current; if (!v) return;
      if (!visCtxRef.current) {
        const vc = v.getContext('2d', { willReadFrequently: true });
        if (!vc) return;
        vc.lineCap = 'round'; vc.lineJoin = 'round'; vc.scale(dpr, dpr); visCtxRef.current = vc;
      }
      if (!bgRef.current) {
        const b = document.createElement('canvas'); b.width = iw; b.height = ih;
        const bc = b.getContext('2d', { willReadFrequently: true })!;
        bc.lineCap = 'round'; bc.lineJoin = 'round'; bc.scale(dpr, dpr); bgRef.current = b; bgCtxRef.current = bc;
      }
      snap();
      pathPts.current = [toLocal(e)];
      drawing.current = true; md(true);
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current) return; e.preventDefault();
      pathPts.current.push(toLocal(e));
      redraw();
    };

    const onUp = () => {
      if (!drawing.current) return;
      drawing.current = false;
      commitToBg();
      pathPts.current = [];
      redraw(); // 最后一次刷新确保背景同步
    };

    const noop = (e: Event) => e.preventDefault();

    const cleanupRef = useRef<(() => void) | null>(null);
    const cbRef = useCallback((el: HTMLCanvasElement | null) => {
      // 先解绑旧事件
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
      if (el) {
        el.width = iw; el.height = ih;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
        el.addEventListener('pointerleave', onUp);
        el.addEventListener('selectstart', noop);
        el.addEventListener('gesturestart', noop);
        el.addEventListener('gesturechange', noop);
        el.addEventListener('gestureend', noop);
        el.addEventListener('contextmenu', noop);
        el.addEventListener('touchstart', noop, { passive: false });
        (visRef as any).current = el;
        cleanupRef.current = () => {
          el.removeEventListener('pointerdown', onDown);
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          el.removeEventListener('pointercancel', onUp);
          el.removeEventListener('pointerleave', onUp);
          el.removeEventListener('selectstart', noop);
          el.removeEventListener('gesturestart', noop);
          el.removeEventListener('gesturechange', noop);
          el.removeEventListener('gestureend', noop);
          el.removeEventListener('contextmenu', noop);
          el.removeEventListener('touchstart', noop);
        };
      }
    }, [width, height]);

    useImperativeHandle(ref, () => ({
      clear: () => { const bg=bgRef.current,vc=visCtxRef.current; if(bg){const c=bgCtxRef.current;c?.clearRect(0,0,width,height);} vc?.clearRect(0,0,width,height); pathPts.current=[]; snapshots.current=[]; md(false); },
      toBlob: () => new Promise(r => { visRef.current?.toBlob(b => r(b), 'image/png'); }),
      isEmpty: () => !hasDrawn.current,
      undo: () => { const s=snapshots.current; if(!s.length)return; const bg=bgCtxRef.current,b=bgRef.current,vc=visCtxRef.current; if(!bg||!b)return; const img=new Image(); img.onload=()=>{bg.clearRect(0,0,width,height);bg.drawImage(img,0,0); if(vc){vc.clearRect(0,0,width,height);vc.drawImage(b,0,0);} if(s.length<=1)md(false);}; img.src=s.pop()!; },
      setMode: (m) => { mode.current = m; },
      getMode: () => mode.current,
      setColor: (c) => { color.current = c; const bc=bgCtxRef.current; if(bc)bc.strokeStyle=c; const vc=visCtxRef.current; if(vc)vc.strokeStyle=c; },
      getColor: () => color.current,
      setWeight: (w) => { weight.current = w; },
      getWeight: () => weight.current,
    }), [width, height]);

    return (
      <canvas ref={cbRef}
        className={`rounded-xl border border-[oklch(0.88_0.005_264)] bg-white ${className}`}
        style={{ width:'100%', aspectRatio:`${width}/${height}`, touchAction:'none',
                 WebkitUserSelect:'none', userSelect:'none', WebkitTouchCallout:'none' }}
      />
    );
  });
AtramentCanvas.displayName = 'AtramentCanvas';
