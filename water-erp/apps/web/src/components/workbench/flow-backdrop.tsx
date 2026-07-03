"use client";

import { useEffect, useRef } from "react";

/** Particle descriptor for the animated light field */
interface FlowParticle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  hue: number;
  alpha: number;
}

const PARTICLE_COUNT = 18;

export function FlowBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<FlowParticle[] | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Seed particles if first run
    if (!particles.current) {
      const { width, height } = canvas.getBoundingClientRect();
      particles.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 2 + Math.random() * 5,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        hue: 210 + Math.random() * 60, // blue-teal range
        alpha: 0.08 + Math.random() * 0.14,
      }));
    }

    const animate = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      particles.current?.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;

        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        gradient.addColorStop(0, `hsla(${p.hue}, 70%, 65%, ${p.alpha})`);
        gradient.addColorStop(0.4, `hsla(${p.hue}, 60%, 60%, ${p.alpha * 0.5})`);
        gradient.addColorStop(1, `hsla(${p.hue}, 50%, 55%, 0)`);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      raf.current = requestAnimationFrame(animate);
    };

    raf.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="flow-backdrop pointer-events-none absolute inset-0 z-0"
      aria-hidden="true"
    />
  );
}
