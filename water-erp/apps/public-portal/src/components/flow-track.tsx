'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export interface StageData {
  no: string;
  en: string;
  title: string;
  desc: string;
  roles: string[];
  color?: string;
}

export interface FlowTrackHandle {
  goNext: () => void;
  goPrev: () => void;
  active: number;
  total: number;
}

export const FlowTrack = forwardRef<FlowTrackHandle, {
  stages: StageData[];
  accent?: 'brand' | 'water';
}>(function FlowTrack({ stages, accent = 'brand' }, ref) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; left: number } | null>(null);
  const animRaf = useRef(0);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;

  const accentVars: CSSProperties | undefined =
    accent === 'water'
      ? ({
          ['--brand' as keyof CSSProperties]: 'oklch(0.5 0.12 175)' as any,
          ['--brand-soft' as keyof CSSProperties]: 'oklch(0.62 0.1 175)' as any,
          ['--brand-deep' as keyof CSSProperties]: 'oklch(0.42 0.12 175)' as any,
        } as CSSProperties)
      : undefined;

  // active stage via IntersectionObserver
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const panels = Array.from(el.querySelectorAll<HTMLElement>('[data-index]'));
    const io = new IntersectionObserver(
      (entries) => {
        if (animRaf.current) return;
        let best: { i: number; r: number } | null = null;
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.index);
            if (!best || e.intersectionRatio > best.r) best = { i, r: e.intersectionRatio };
          }
        }
        if (best) setActive(best.i);
      },
      { root: el, threshold: [0.45, 0.6, 0.75] },
    );
    panels.forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, []);


  const goTo = useCallback(
    (i: number) => {
      const el = trackRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(i, stages.length - 1));
      const panel = el.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
      if (!panel) return;

      cancelAnimationFrame(animRaf.current);

      // Center the target panel in the viewport
      const targetLeft = panel.offsetLeft - el.clientWidth / 2 + panel.clientWidth / 2;
      const startLeft = el.scrollLeft;
      const delta = targetLeft - startLeft;
      const duration = 380;
      const startTime = performance.now();

      setActive(clamped);

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.scrollLeft = startLeft + delta * eased;
        if (t < 1) {
          animRaf.current = requestAnimationFrame(step);
        } else {
          animRaf.current = 0;
        }
      };
      animRaf.current = requestAnimationFrame(step);
    },
    [stages.length],
  );

  useImperativeHandle(ref, () => ({
    goPrev: () => goTo(activeRef.current - 1),
    goNext: () => goTo(activeRef.current + 1),
    active,
    total: stages.length,
  }), [goTo, active, stages.length]);

  // drag-to-scroll
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = trackRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, left: el.scrollLeft };
    el.classList.add('dragging');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    const st = dragRef.current;
    if (!el || !st) return;
    el.scrollLeft = st.left - (e.clientX - st.x);
  };
  const endDrag = () => {
    const el = trackRef.current;
    dragRef.current = null;
    el?.classList.remove('dragging');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1); }
  };

  const atStart = active <= 0;
  const atEnd = active >= stages.length - 1;

  return (
    <div className="flow-h" style={accentVars} data-accent={accent} tabIndex={0} onKeyDown={onKeyDown} role="region" aria-label="流程浏览">
      {/* ── Progress row: left arrow · colored blocks · right arrow ── */}
      <div className="flow-h-row">
        <button
          type="button"
          className="flow-h-row-arrow"
          onClick={() => goTo(active - 1)}
          disabled={atStart}
          aria-label="上一环节"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>

        <div className="flow-h-row-blocks" aria-hidden>
          {stages.map((s, i) => {
            let state: 'done' | 'active' | 'next';
            if (i < active) state = 'done';
            else if (i === active) state = 'active';
            else state = 'next';
            return (
              <button
                type="button"
                key={s.no}
                className={`flow-h-block flow-h-block-${state}`}
                style={{ '--block-color': s.color || '#7ec8e3' } as CSSProperties}
                onClick={() => goTo(i)}
                aria-label={`跳转到 ${s.title}`}
              />
            );
          })}
        </div>

        <button
          type="button"
          className="flow-h-row-arrow"
          onClick={() => goTo(active + 1)}
          disabled={atEnd}
          aria-label="下一环节"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>

      {/* ── Cards scroll track ── */}
      <div
        className="flow-h-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="flow-h-scroller">
          {stages.map((s, i) => (
            <div key={s.no} className={`flow-h-panel ${i === active ? 'on' : ''}`} data-index={i}>
              <div className="flow-h-card" style={{ '--card-color': s.color || '#7ec8e3' } as CSSProperties}>
                <span className="flow-card-tag" style={{ color: s.color, background: `${s.color}1a` }}>{s.en}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <div className="flow-chips">
                  {s.roles.map((r) => (
                    <span key={r} className="flow-chip" style={{ borderColor: `${s.color}33`, color: s.color }}>{r}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/* fixed pastel blooms + floating particles */
const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  i,
  left: `${(i * 61) % 100}%`,
  size: `${3 + ((i * 7) % 5)}px`,
  duration: `${16 + ((i * 13) % 18)}s`,
  delay: `${(i * 3.7) % 20}s`,
}));

export function FlowBackdrop() {
  return (
    <>
      <div className="flow-glow" aria-hidden />
      <div className="flow-particles" aria-hidden>
        {PARTICLES.map((p) => (
          <span
            key={p.i}
            className="flow-particle"
            style={{ left: p.left, width: p.size, height: p.size, animationDuration: p.duration, animationDelay: p.delay }}
          />
        ))}
      </div>
    </>
  );
}
