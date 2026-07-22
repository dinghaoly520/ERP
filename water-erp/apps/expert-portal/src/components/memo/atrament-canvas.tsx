'use client';

import { useImperativeHandle, useRef, forwardRef, useCallback, useState } from 'react';

export interface AtramentCanvasHandle {
  clear: () => void;  toBlob: () => Promise<Blob | null>;  isEmpty: () => boolean;
  undo: () => void;  setMode: (m: 'draw' | 'erase') => void;  getMode: () => 'draw' | 'erase';
  setColor: (c: string) => void;  getColor: () => string;
  setWeight: (w: number) => void;  getWeight: () => number;
  setEraserMul: (m: number) => void;  getEraserMul: () => number;
  setZoom: (z: number) => void;  getZoom: () => number;
  /** 将 PNG Blob 绘制到背景画布。scale 可选缩放倍率（<1 缩小，=1 原始尺寸）。 */
  restoreBlob: (blob: Blob, scale?: number) => Promise<void>;
  /** 同步导出可见画布为 dataURL（无竞态，用于得分点切换快速捕获） */
  captureDataURL: () => string;
  /** 导出矢量笔触数组（跨 canvas 清晰转移用，支持按比例缩放重绘） */
  captureStrokes: () => Stroke[];
  /** 按矢量笔触重绘到当前画布。coordScale 缩放坐标，weightScale 缩放笔触粗细（独立） */
  restoreStrokes: (srcStrokes: Stroke[], coordScale?: number, weightScale?: number) => void;
}

interface Props {
  width?: number; height?: number; strokeColor?: string; baseWeight?: number;
  className?: string;  onDirtyChange?: (dirty: boolean) => void;
  /** 填满父容器高度（由外层 flex-1 决定高），不再用 padding-bottom 宽高比撑高——全屏 flex 布局用，避免宽屏下 padding-bottom% 相对宽度算出过高把兄弟元素顶出视口 */
  fillContainer?: boolean;
}

interface Point { x: number; y: number; pressure: number }

/** 一笔的矢量数据（用于跨 canvas 清晰转移，按比例缩放重绘） */
export interface Stroke {
  pts: Point[];
  color: string;
  weight: number;
  mode: 'draw' | 'erase';
  eraserMul: number;
}

/** 半宽（pressure → 半径）。压感灵敏 + 最小宽度保证可见。eraserMul 橡皮模式放大倍率 */
function halfW(pv: number, baseW: number, eraserMul = 1): number {
  return Math.max(1.2, baseW * (0.25 + 0.75 * Math.pow(pv, 1.6))) / 2 * eraserMul;
}

/** 逐 pair 画填充四边形 + 节点圆。每段用自己的压力→宽，一笔之内轻重粗细实时变化 */
function drawPath(ctx: CanvasRenderingContext2D, pts: Point[], baseW: number, eraserMul = 1) {
  const hw = (pv: number) => halfW(pv, baseW, eraserMul);
  if (pts.length < 2) {
    if (pts.length === 1) {
      const r = hw(pts[0].pressure);
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }
  {
    const r = hw(pts[0].pressure);
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.02) continue;
    const nx = -dy / len, ny = dx / len;
    const ra = hw(a.pressure), rb = hw(b.pressure);
    ctx.beginPath();
    ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
    ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
    ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
    ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, rb, 0, Math.PI * 2); ctx.fill();
  }
}

export const AtramentCanvas = forwardRef<AtramentCanvasHandle, Props>(
  ({ width = 600, height = 420, strokeColor = '#000000', baseWeight = 6, className = '', onDirtyChange, fillContainer = false },
   ref) => {
    const visRef = useRef<HTMLCanvasElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bgRef = useRef<HTMLCanvasElement | null>(null);
    const bgCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const visCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const snapshots = useRef<string[]>([]);
    const strokes = useRef<Stroke[]>([]);
    const hasDrawn = useRef(false);
    const drawing = useRef(false);
    const pathPts = useRef<Point[]>([]);
    const color = useRef(strokeColor);
    const weight = useRef(baseWeight);
    const mode = useRef<'draw' | 'erase'>('draw');
    const eraserMul = useRef(3);
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
      vc.fillStyle = mode.current === 'erase' ? '#ffffff' : color.current;
      drawPath(vc, pathPts.current, weight.current, mode.current === 'erase' ? eraserMul.current : 1);
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
      bgCtx.strokeStyle = color.current;
      bgCtx.fillStyle = mode.current === 'erase' ? '#ffffff' : color.current;
      drawPath(bgCtx, pathPts.current, weight.current, mode.current === 'erase' ? eraserMul.current : 1);
      // 记录矢量笔触（跨 canvas 清晰转移用）
      strokes.current.push({
        pts: pathPts.current.map(p => ({ ...p })),
        color: color.current,
        weight: weight.current,
        mode: mode.current,
        eraserMul: eraserMul.current,
      });
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      // 手掌抑制：只接受 Apple Pencil
      if (!isPen(e)) return;
      if (!ensureContexts()) return;
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

    // 确保 bg / vis 上下文存在（首次 onDown 或 restoreBlob 时都可能需要）
    const ensureContexts = (): boolean => {
      const v = visRef.current;
      if (!v) return false;
      if (!visCtxRef.current) {
        const vc = v.getContext('2d', { willReadFrequently: true });
        if (!vc) return false;
        vc.lineCap = 'round'; vc.lineJoin = 'round';
        visCtxRef.current = vc;
      }
      if (!bgRef.current) {
        const b = document.createElement('canvas'); b.width = width; b.height = height;
        const bc = b.getContext('2d', { willReadFrequently: true });
        if (!bc) return false;
        bc.lineCap = 'round'; bc.lineJoin = 'round';
        bgRef.current = b; bgCtxRef.current = bc;
      }
      return true;
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
      clear: () => { const bg=bgRef.current,vc=visCtxRef.current; if(bg){const c=bgCtxRef.current;c?.clearRect(0,0,width,height);} vc?.clearRect(0,0,width,height); pathPts.current=[]; snapshots.current=[]; strokes.current=[]; md(false); },
      toBlob: () => new Promise(r => { visRef.current?.toBlob(b => r(b), 'image/png'); }),
      isEmpty: () => !hasDrawn.current,
      undo: () => { const s=snapshots.current; if(!s.length)return; strokes.current.pop(); const bg=bgCtxRef.current,b=bgRef.current,vc=visCtxRef.current; if(!bg||!b)return; const img=new Image(); img.onload=()=>{bg.clearRect(0,0,width,height);bg.drawImage(img,0,0); if(vc){vc.clearRect(0,0,width,height);vc.drawImage(b,0,0);} md(strokes.current.length>0);}; img.src=s.pop()!; }, // P1-11：以剩余矢量笔触数判空（修复剩 1 笔误判为空）
      setMode: (m) => { mode.current = m; },
      getMode: () => mode.current,
      setColor: (c) => { color.current = c; const bc=bgCtxRef.current; if(bc)bc.strokeStyle=c; const vc=visCtxRef.current; if(vc)vc.strokeStyle=c; },
      getColor: () => color.current,
      setWeight: (w) => { weight.current = w; },
      getWeight: () => weight.current,
      setEraserMul: (m: number) => { eraserMul.current = Math.max(1, Math.min(20, m)); },
      getEraserMul: () => eraserMul.current,
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
      captureDataURL: () => {
        // 先把当前绘制中的笔触提交到背景
        if (pathPts.current.length > 0) {
          const bgCtx = bgCtxRef.current;
          if (bgCtx) {
            bgCtx.fillStyle = mode.current === 'erase' ? '#ffffff' : color.current;
            drawPath(bgCtx, pathPts.current, weight.current, mode.current === 'erase' ? eraserMul.current : 1);
          }
          pathPts.current = [];
        }
        const bg = bgRef.current;
        return bg ? bg.toDataURL('image/png') : '';
      },
      captureStrokes: () => strokes.current.map(s => ({
        pts: s.pts.map(p => ({ ...p })),
        color: s.color, weight: s.weight, mode: s.mode, eraserMul: s.eraserMul,
      })),
      restoreStrokes: (srcStrokes: Stroke[], coordScale?: number, weightScale?: number) => {
        if (!ensureContexts()) return;
        const bgCtx = bgCtxRef.current!;
        const bg = bgRef.current!;
        const vc = visCtxRef.current!;
        const cs = coordScale && coordScale !== 1 ? coordScale : 1;
        const ws = weightScale && weightScale !== 1 ? weightScale : 1;
        bgCtx.clearRect(0, 0, width, height);
        const scaled: Stroke[] = [];
        for (const st of srcStrokes) {
          // 坐标按 coordScale 缩放（字占左上角），weight 按 weightScale 缩放（视觉粗细一致）
          const pts = st.pts.map(p => ({ x: p.x * cs, y: p.y * cs, pressure: p.pressure }));
          bgCtx.fillStyle = st.mode === 'erase' ? '#ffffff' : st.color;
          drawPath(bgCtx, pts, st.weight * ws, st.mode === 'erase' ? st.eraserMul : 1);
          scaled.push({
            pts: pts.map(p => ({ ...p })),
            color: st.color, weight: st.weight * ws, mode: st.mode, eraserMul: st.eraserMul,
          });
        }
        vc.save(); vc.setTransform(1, 0, 0, 1, 0, 0);
        vc.clearRect(0, 0, width, height);
        vc.drawImage(bg, 0, 0);
        vc.restore();
        strokes.current = scaled;
        hasDrawn.current = scaled.length > 0;
        md(scaled.length > 0);
      },
      restoreBlob: (blob: Blob, scale?: number) => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          // 全新 canvas（尚未 onDown）bgRef 为空 → 先创建
          if (!ensureContexts()) { resolve(); return; }
          const bgCtx = bgCtxRef.current!;
          const bg = bgRef.current!;
          const vc = visCtxRef.current!;
          const s = scale && scale !== 1 ? scale : 1;
          const dw = Math.round(img.width * s);
          const dh = Math.round(img.height * s);
          bgCtx.clearRect(0, 0, width, height);
          bgCtx.drawImage(img, 0, 0, dw, dh);
          vc.save(); vc.setTransform(1, 0, 0, 1, 0, 0);
          vc.clearRect(0, 0, width, height);
          vc.drawImage(bg, 0, 0);
          vc.restore();
          hasDrawn.current = true;
          md(true);
          resolve();
        };
        img.src = URL.createObjectURL(blob);
      }),
    }), [width, height]);

    return (
      <div className={`relative rounded-xl border border-[oklch(0.88_0.005_264)] bg-white ${className}`}
        style={fillContainer
          ? { width: '100%' }
          : { width: '100%', paddingBottom: `${(height / width) * 100}%` }}>
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
