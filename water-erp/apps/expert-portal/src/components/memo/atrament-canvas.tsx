'use client';

import { useImperativeHandle, useRef, forwardRef, useCallback, useState } from 'react';

export interface AtramentCanvasHandle {
  clear: () => void;  toBlob: () => Promise<Blob | null>;  isEmpty: () => boolean;
  undo: () => void;  setMode: (m: 'draw' | 'erase') => void;  getMode: () => 'draw' | 'erase';
  setColor: (c: string) => void;  getColor: () => string;
  setWeight: (w: number) => void;  getWeight: () => number;
  /** 设置缩放（1=100%，2=200%）。缩放>1 时容器出现滚动条 */
  setZoom: (z: number) => void;  getZoom: () => number;
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
  ({ width = 600, height = 420, strokeColor = '#1e3a5f', baseWeight = 6, className = '', onDirtyChange },
   ref) => {
    const visRef = useRef<HTMLCanvasElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
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
    const [zoom, setZoom] = useState(1);

    const toLocal = (e: PointerEvent): Point => {
      const c = visRef.current!;
      const r = c.getBoundingClientRect();
      const x = Math.min(width - 1, Math.max(0, (e.clientX - r.left) * (width / r.width)));
      const y = Math.min(height - 1, Math.max(0, (e.clientY - r.top) * (height / r.height)));
      const pv = e.pressure;
      return { x, y, pressure: (pv > 0 && pv <= 1) ? pv : 0.5 };
    };

    // 手掌抑制：只接受 Apple Pencil（pointerType='pen'），手指/鼠标不画
    const isPen = (e: PointerEvent) => e.pointerType === 'pen';

    const redraw = () => {
      const vc = visCtxRef.current; const bg = bgRef.current;
      if (!vc || !bg) return;
      vc.save(); vc.setTransform(1, 0, 0, 1, 0, 0);
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
      // 手掌抑制：只接受 Apple Pencil
      if (!isPen(e)) return;
      const v = visRef.current; if (!v) return;
      if (!visCtxRef.current) {
        const vc = v.getContext('2d', { willReadFrequently: true });
        if (!vc) return;
        vc.lineCap = 'round'; vc.lineJoin = 'round'; visCtxRef.current = vc;
      }
      if (!bgRef.current) {
        const b = document.createElement('canvas'); b.width = width; b.height = height;
        const bc = b.getContext('2d', { willReadFrequently: true })!;
        bc.lineCap = 'round'; bc.lineJoin = 'round'; bgRef.current = b; bgCtxRef.current = bc;
      }
      snap();
      pathPts.current = [toLocal(e)];
      drawing.current = true; md(true);
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current) return;
      if (!isPen(e)) return; // 手掌/手指不给加轨迹
      e.preventDefault();
      pathPts.current.push(toLocal(e));
      redraw();
    };

    const onUp = (e: PointerEvent) => {
      if (!drawing.current) return;
      if (e.pointerType !== 'pen') return; // 手掌抬起别把笔的 stroke 关了
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
        el.width = width; el.height = height;
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
      setZoom: (z: number) => {
        const v = Math.max(0.5, Math.min(3, z));
        setZoom(v);
        // canvas 内部分辨率不变，只需清屏显示背景
        requestAnimationFrame(() => {
          const vc = visCtxRef.current;
          if (vc && bgRef.current) {
            vc.save(); vc.setTransform(1,0,0,1,0,0);
            vc.clearRect(0,0,width,height); vc.drawImage(bgRef.current,0,0);
            vc.restore();
          }
        });
      },
      getZoom: () => zoom,
    }), [width, height]);

    return (
      <div className={`relative rounded-xl border border-[oklch(0.88_0.005_264)] bg-white ${className}`}
        style={{ width:'100%', paddingBottom:`${(height/width)*100}%` }}>
        <div ref={scrollRef} className="absolute inset-0 overflow-auto rounded-xl">
          <canvas ref={cbRef} className="block"
            style={{
              ...(zoom <= 1
                ? { width: '100%', height: '100%' }
                : { width: width * zoom, height: height * zoom }),
              touchAction:'none', WebkitUserSelect:'none', userSelect:'none', WebkitTouchCallout:'none',
            }}
          />
        </div>
      </div>
    );
  });
AtramentCanvas.displayName = 'AtramentCanvas';
