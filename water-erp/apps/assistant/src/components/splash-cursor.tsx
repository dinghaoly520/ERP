'use client';

import { useEffect, useRef } from 'react';

// RGB values corresponding to: 蓝 / 青 / 金 / 绿 / 紫
const COLORS: Array<[number, number, number]> = [
  [58, 130, 246],    // 蓝
  [34, 197, 220],    // 青
  [214, 171, 103],   // 金
  [34, 197, 94],     // 绿
  [139, 92, 246],    // 紫
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
}

export function SplashCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -100, y: -100 });
  const rafRef = useRef<number>(0);
  const lastSpawnRef = useRef(0);

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

    const handleMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMove, { passive: true });

    const animate = (time: number) => {
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Spawn new particles every ~28ms when mouse is on screen
      if (mx > 0 && my > 0 && time - lastSpawnRef.current > 28) {
        lastSpawnRef.current = time;
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        for (let i = 0; i < 2; i++) {
          particlesRef.current.push({
            x: mx + (Math.random() - 0.5) * 8,
            y: my + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 1.2 - 1.5,
            life: 0,
            maxLife: 40 + Math.random() * 30,
            size: 3 + Math.random() * 5,
            color,
          });
        }
      }

      // Clear canvas with slight fade for trail effect
      ctx.clearRect(0, 0, w, h);

      // Draw and update particles
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        const progress = p.life / p.maxLife;
        if (progress >= 1) continue; // dead

        const alpha = 1 - progress;
        const scale = 1 - progress * 0.7;
        const r = p.size * scale;

        const [cr, cg, cb] = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
        ctx.fill();

        alive.push(p);
      }
      particlesRef.current = alive;

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
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
