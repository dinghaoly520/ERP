'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export interface StageData {
  no: string;
  en: string;
  title: string;
  desc: string;
  roles: string[];
}

/**
 * 横向流程管线 —— horizontal, scroll-snapped process pipeline.
 * Interactions: wheel→horizontal, drag-to-scroll, keyboard ◀ ▶,
 * prev/next arrows (one stage per click), clickable node + dot nav, live progress.
 */
export function FlowTrack({
  stages,
  accent = 'brand',
}: {
  stages: StageData[];
  accent?: 'brand' | 'water';
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; left: number } | null>(null);
  const lockRef = useRef(false); // suppress IO updates during a button-driven animation
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  const accentVars: CSSProperties | undefined =
    accent === 'water'
      ? ({
          ['--brand' as keyof CSSProperties]: 'oklch(0.5 0.12 175)' as any,
          ['--brand-soft' as keyof CSSProperties]: 'oklch(0.62 0.1 175)' as any,
          ['--brand-deep' as keyof CSSProperties]: 'oklch(0.42 0.12 175)' as any,
        } as CSSProperties)
      : undefined;

  // active stage via IntersectionObserver on the horizontal axis (skipped while locked)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const panels = Array.from(el.querySelectorAll<HTMLElement>('[data-index]'));
    const io = new IntersectionObserver(
      (entries) => {
        if (lockRef.current) return;
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

  // progress (0..1) from scroll position
  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setProgress(max > 0 ? el.scrollLeft / max : 0);
  }, []);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  // wheel → horizontal (native listener so we can preventDefault)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // jump to a stage: set active instantly + lock IO during the smooth scroll,
  // so each arrow click advances exactly one stage with no flicker / desync.
  const goTo = useCallback(
    (i: number) => {
      const el = trackRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(i, stages.length - 1));
      if (clamped === active) return;
      lockRef.current = true;
      setActive(clamped);
      const panel = el.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
      panel?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      window.setTimeout(() => {
        lockRef.current = false;
      }, 700);
    },
    [stages.length, active],
  );

  // drag-to-scroll (mouse / pen only — touch uses native scroll)
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
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  const lineFill = stages.length > 1 ? (active / (stages.length - 1)) * 100 : 100;
  const fill = Math.min(1, Math.max(0, progress));
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="flow-h" style={accentVars} tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label="流程浏览">
      {/* control bar — number badge rides the progress line */}
      <div className="flow-h-bar">
        <button
          type="button"
          className="flow-h-arrow"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="上一步"
        >
          ‹
        </button>
        <div className="flow-h-progress" style={{ ['--fill' as keyof CSSProperties]: fill } as CSSProperties} aria-hidden>
          <div className="flow-h-progress-fill" />
          <div className="flow-h-progress-badge">{pad(active + 1)}</div>
        </div>
        <span className="flow-h-total">/ {pad(stages.length)}</span>
        <button
          type="button"
          className="flow-h-arrow"
          onClick={() => goTo(active + 1)}
          disabled={active === stages.length - 1}
          aria-label="下一步"
        >
          ›
        </button>
      </div>

      {/* horizontal scroll track */}
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
          <div className="flow-h-line" aria-hidden>
            <div className="flow-h-line-fill" style={{ width: `${lineFill}%` }} />
            <div className="flow-h-line-flow" />
          </div>
          {stages.map((s, i) => (
            <div key={s.no} className={`flow-h-panel ${i === active ? 'on' : ''}`} data-index={i}>
              <button
                type="button"
                className={`flow-h-node ${i === active ? 'on' : i < active ? 'done' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`${s.no} ${s.title}`}
              >
                {s.no}
              </button>
              <div className="flow-h-tick" />
              <div className="flow-h-card">
                <span className="flow-card-tag">{s.en}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <div className="flow-chips">
                  {s.roles.map((r) => (
                    <span key={r} className="flow-chip">{r}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* node dots */}
      <div className="flow-h-dots">
        {stages.map((s, i) => (
          <button
            key={s.no}
            className={`flow-h-dot ${i === active ? 'on' : ''}`}
            onClick={() => goTo(i)}
            aria-label={`跳转到 ${s.title}`}
          />
        ))}
      </div>
      <div className="flow-h-hint">‹ 滚动 / 拖拽 / 方向键 浏览全流程 ›</div>
    </div>
  );
}

/* fixed pastel blooms + grid + floating particles */
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
      <div className="flow-grid" aria-hidden />
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
