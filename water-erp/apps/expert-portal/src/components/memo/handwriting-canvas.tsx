'use client';

import { useImperativeHandle, useRef, forwardRef } from 'react';

export interface HandwritingCanvasHandle {
  /** 清空画布并重置 ink 标记 */
  clear: () => void;
  /** 导出 PNG Blob；canvas 未挂载时返回 null */
  toBlob: () => Promise<Blob | null>;
  /** 是否已有笔画（用于提交前校验） */
  isEmpty: () => boolean;
}

interface HandwritingCanvasProps {
  /** canvas 内部分辨率宽（像素） */
  width?: number;
  /** canvas 内部分辨率高（像素） */
  height?: number;
  /** 笔触颜色 */
  strokeColor?: string;
}

/**
 * 平板手写画布组件。
 *
 * - pointer events 绘制笔画，setPointerCapture 保证拖出 canvas 仍可绘制。
 * - 坐标按 CSS 尺寸 → canvas 内部分辨率缩放，避免 HiDPI 模糊。
 * - `touch-action: none`（内联 style）阻止平板滚动/缩放干扰手写。
 * - 通过 ref 暴露 `{ clear, toBlob, isEmpty }` 供调用方提交前校验与导出 PNG。
 */
export const HandwritingCanvas = forwardRef<HandwritingCanvasHandle, HandwritingCanvasProps>(
  ({ width = 600, height = 320, strokeColor = '#1e3a5f' }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const hasInk = useRef(false);

    const getCtx = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      return ctx;
    };

    /** 将指针客户端坐标映射到 canvas 内部分辨率坐标 */
    const pos = (e: React.PointerEvent) => {
      const r = canvasRef.current!.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (width / r.width),
        y: (e.clientY - r.top) * (height / r.height),
      };
    };

    const down = (e: React.PointerEvent) => {
      e.preventDefault();
      drawing.current = true;
      hasInk.current = true;
      const ctx = getCtx();
      const p = pos(e);
      ctx?.beginPath();
      ctx?.moveTo(p.x, p.y);
      canvasRef.current?.setPointerCapture(e.pointerId);
    };

    const move = (e: React.PointerEvent) => {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = getCtx();
      const p = pos(e);
      ctx?.lineTo(p.x, p.y);
      ctx?.stroke();
    };

    const up = () => {
      drawing.current = false;
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        const ctx = getCtx();
        ctx?.clearRect(0, 0, width, height);
        hasInk.current = false;
      },
      isEmpty: () => !hasInk.current,
      toBlob: () =>
        new Promise<Blob | null>(resolve => {
          const canvas = canvasRef.current;
          if (!canvas) {
            resolve(null);
            return;
          }
          canvas.toBlob(b => resolve(b), 'image/png');
        }),
    }));

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="w-full rounded-xl border border-[oklch(0.88_0.005_264)] bg-white"
        style={{ aspectRatio: `${width} / ${height}`, touchAction: 'none' }}
      />
    );
  },
);

HandwritingCanvas.displayName = 'HandwritingCanvas';
