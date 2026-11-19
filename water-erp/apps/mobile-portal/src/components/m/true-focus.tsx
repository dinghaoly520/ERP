"use client";

import { useEffect, useRef, useState } from "react";

/**
 * TrueFocus 逐字聚焦落款特效（framer-motion-free 移植版，spec 2026-11-19）。
 * 源自 apps/web/src/components/TrueFocus.jsx（ReactBits），按 :3011 零依赖路线重写：
 * - 逐字 blur 切换：CSS class（.is-active）+ transition，blur/时长经 CSS 变量下发
 * - 聚焦框滑动：绝对定位 div，left/top/width/height 由 ref 实测写入 + CSS transition
 * 行为口径与 web 版一致：interval 按 (animationDuration + pauseBetweenAnimations) 推进下标；
 * reduced-motion 由调用方双渲染静态整句（本组件不感知）。
 * 样式落点：globals.css `.login-credit .focus-*` 段（与 web 同名选择器）。
 */

export type TrueFocusProps = {
  sentence: string;
  separator?: string;
  /** 激活字 blur→0、其余字 blur 到该像素量 */
  blurAmount?: number;
  borderColor?: string;
  glowColor?: string;
  /** 单次聚焦过渡时长（秒）——同时驱动聚焦框滑动与字 blur 过渡 */
  animationDuration?: number;
  /** 两字聚焦之间的停顿（秒） */
  pauseBetweenAnimations?: number;
};

export function TrueFocus({
  sentence,
  separator = " ",
  blurAmount = 3,
  borderColor = "#7aa8ff",
  glowColor = "rgba(122, 168, 255, 0.18)",
  animationDuration = 0.5,
  pauseBetweenAnimations = 1,
}: TrueFocusProps) {
  const words = sentence.split(separator);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [focusRect, setFocusRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        setCurrentIndex((prev) => (prev + 1) % words.length);
      },
      (animationDuration + pauseBetweenAnimations) * 1000,
    );
    return () => window.clearInterval(interval);
  }, [animationDuration, pauseBetweenAnimations, words.length]);

  useEffect(() => {
    if (currentIndex < 0 || !containerRef.current) return;
    const activeEl = wordRefs.current[currentIndex];
    if (!activeEl) return;
    const parentRect = containerRef.current.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    setFocusRect({
      x: activeRect.left - parentRect.left,
      y: activeRect.top - parentRect.top,
      width: activeRect.width,
      height: activeRect.height,
    });
  }, [currentIndex, words.length]);

  return (
    <div
      className="focus-container"
      ref={containerRef}
      style={
        {
          "--focus-blur": `${blurAmount}px`,
          "--focus-duration": `${animationDuration}s`,
          "--focus-border-color": borderColor,
          "--focus-glow-color": glowColor,
        } as React.CSSProperties
      }
    >
      {words.map((word, index) => (
        <span
          key={index}
          ref={(el) => {
            wordRefs.current[index] = el;
          }}
          className={`focus-word${index === currentIndex ? " is-active" : ""}`}
        >
          {word}
        </span>
      ))}

      <div
        className="focus-frame"
        style={
          focusRect
            ? {
                left: `${focusRect.x}px`,
                top: `${focusRect.y}px`,
                width: `${focusRect.width}px`,
                height: `${focusRect.height}px`,
                opacity: 1,
              }
            : undefined
        }
      >
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />
      </div>
    </div>
  );
}
