'use client';

import { useEffect, useRef } from 'react';

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

const MAX_AGE = 60;    // frames point survives
const MAX_LEN = 40;    // max trail points to draw
const SPAWN_EVERY = 2; // add a point every N frames

export function SplashCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener('resize', resize);

    const trail: TrailPoint[] = [];
    const mouse = { x: -100, y: -100 };
    let frame = 0;

    const handleMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMove, { passive: true });

    const animate = () => {
      frame++;
      ctx.clearRect(0, 0, w, h);

      // Add current mouse position to trail
      if (mouse.x > 0 && mouse.y > 0 && frame % SPAWN_EVERY === 0) {
        trail.push({ x: mouse.x, y: mouse.y, age: 0 });
      }

      // Age all points
      for (const p of trail) p.age++;

      // Trim old points
      while (trail.length > MAX_LEN) trail.shift();
      while (trail.length > 0 && trail[0].age > MAX_AGE) trail.shift();

      if (trail.length < 3) {
        requestAnimationFrame(animate);
        return;
      }

      // Draw 3 layers of flowing gossamer veil, each offset slightly
      const layers = [
        { offset: 0,  color: '88, 164, 255', width: 14 },   // blue
        { offset: 3,  color: '145, 132, 255', width: 10 },   // violet
        { offset: 6,  color: '214, 171, 103', width: 8 },    // gold
      ];

      for (const layer of layers) {
        if (trail.length < 3) continue;

        // Build control points offset from main trail
        const points: { x: number; y: number }[] = [];
        for (const p of trail) {
          const t = p.age / MAX_AGE;
          const yOff = Math.sin(p.age * 0.3 + layer.offset) * layer.offset * 0.6;
          const xOff = Math.cos(p.age * 0.25 + layer.offset) * layer.offset * 0.4;
          points.push({ x: p.x + xOff, y: p.y + yOff });
        }

        // Draw smooth curve through points
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        // Last segment
        const last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);

        // Compute stroke alpha from trail age (fade out at both ends)
        const headAge = trail[trail.length - 1].age / MAX_AGE;
        const tailAge = trail[0].age / MAX_AGE;
        const headAlpha = 1 - headAge;
        const tailAlpha = 1 - tailAge;

        // Head gradient opacity by point index
        const maxW = layer.width * (0.5 + 0.5 * headAlpha);
        const minW = 1;

        // Draw each segment individually with varying opacity & width
        ctx.strokeStyle = `rgba(${layer.color},${(0.25 * headAlpha).toFixed(2)})`;
        ctx.lineWidth = maxW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Second pass: thinner highlight on top
        ctx.strokeStyle = `rgba(${layer.color},${(0.45 * headAlpha).toFixed(2)})`;
        ctx.lineWidth = maxW * 0.35;
        ctx.stroke();
      }

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
