"use client";

import { useEffect, useRef, useState } from "react";
import { DINGDANG_IMAGES, type SpriteExpression } from "./sprite-images";

export type { SpriteExpression } from "./sprite-images";

/**
 * 小型水叮当头像 — 用于聊天消息和面板标题栏。
 * Hover 时放大、光晕增强。表情切换时 crossfade + 弹性缩放。
 */
export function MiniSprite({
  size = 36,
  expression = "normal",
  animated = true,
  className = "",
}: {
  size?: number;
  expression?: SpriteExpression;
  animated?: boolean;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [prevExpr, setPrevExpr] = useState<SpriteExpression>(expression);
  const prevExpression = useRef<SpriteExpression>(expression);

  useEffect(() => {
    if (prevExpression.current !== expression) {
      setPrevExpr(prevExpression.current);  // freeze old face
      setSwitching(true);
      prevExpression.current = expression;
      const t = setTimeout(() => {
        setSwitching(false);
        setPrevExpr(expression);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [expression]);

  const currentExpr = switching ? prevExpr : expression;
  const imgSrc = `/DingDang/${DINGDANG_IMAGES[currentExpr]}_sm.webp`;
  const nextImgSrc = switching ? `/DingDang/${DINGDANG_IMAGES[expression]}_sm.webp` : undefined;

  return (
    <span
      className={`asst-sprite-sm ${hovered ? "asst-sprite-sm-hover" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        animation: animated && !switching ? "waterBreathe 4s cubic-bezier(0.22,1,0.36,1) infinite" : "none",
        background: `
          radial-gradient(circle at 34% 26%, rgba(210,232,255,0.96) 0%, rgba(130,185,255,0.82) 50%, rgba(82,145,248,0.74) 100%),
          radial-gradient(circle at 64% 72%, rgba(60,120,230,0.28), transparent 55%)
        `,
        border: `${Math.max(1.5, size * 0.05)}px solid rgba(255,255,255,0.55)`,
        boxShadow: hovered
          ? `
            0 ${size * 0.12}px ${size * 0.35}px rgba(80,140,240,0.3),
            0 ${size * 0.04}px ${size * 0.15}px rgba(80,140,240,0.2),
            inset 0 ${size * 0.06}px ${size * 0.14}px rgba(255,255,255,0.45),
            inset 0 -${size * 0.06}px ${size * 0.16}px rgba(40,90,200,0.12)
          `
          : `
            0 ${size * 0.06}px ${size * 0.25}px rgba(80,140,240,0.18),
            inset 0 ${size * 0.06}px ${size * 0.12}px rgba(255,255,255,0.35),
            inset 0 -${size * 0.05}px ${size * 0.14}px rgba(40,90,200,0.08)
          `,
        transition: "transform 250ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 300ms ease",
        transform: hovered ? "scale(1.15)" : "scale(1)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Highlight — top-left crescent */}
      <span
        className="asst-sprite-sm-highlight"
        style={{
          top: size * 0.12,
          left: size * 0.16,
          width: size * 0.32,
          height: size * 0.18,
          opacity: hovered ? 0.9 : 0.6,
          transition: "opacity 300ms ease",
        }}
      />
      {/* 当前表情 — swapping 时缩小淡出 */}
      <img
        src={imgSrc}
        alt="水叮当"
        className={`asst-sprite-img-face ${switching ? "asst-sprite-img-out" : ""}`}
        style={{ borderRadius: "50%" }}
      />
      {/* 新表情 — swapping 时弹性放大淡入 */}
      {switching && nextImgSrc && (
        <img
          src={nextImgSrc}
          alt="水叮当"
          className="asst-sprite-img-face asst-sprite-img-in"
          style={{ borderRadius: "50%" }}
        />
      )}
    </span>
  );
}
