"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAssistant } from "./assistant-provider";
import { DINGDANG_IMAGES, type SpriteExpression } from "./sprite-images";

const HALO_STOPS: Array<{ outer: string; mid: string; core: string }> = [
  { outer: "oklch(0.62 0.14 251 / 0.25) 0%, oklch(0.62 0.14 251 / 0.08) 50%, transparent 75%", mid: "oklch(0.66 0.12 252 / 0.35) 30%, oklch(0.72 0.09 253 / 0.18) 60%, transparent 80%", core: "oklch(0.78 0.07 253 / 0.55) 40%, oklch(0.72 0.1 252 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.6 0.15 290 / 0.25) 0%, oklch(0.6 0.15 290 / 0.08) 50%, transparent 75%", mid: "oklch(0.64 0.13 292 / 0.35) 30%, oklch(0.7 0.1 295 / 0.18) 60%, transparent 80%", core: "oklch(0.76 0.08 296 / 0.55) 40%, oklch(0.68 0.11 293 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.6 0.12 220 / 0.25) 0%, oklch(0.6 0.12 220 / 0.08) 50%, transparent 75%", mid: "oklch(0.65 0.1 222 / 0.35) 30%, oklch(0.7 0.08 224 / 0.18) 60%, transparent 80%", core: "oklch(0.76 0.06 226 / 0.55) 40%, oklch(0.7 0.09 223 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.62 0.16 65 / 0.25) 0%, oklch(0.62 0.16 65 / 0.08) 50%, transparent 75%", mid: "oklch(0.66 0.14 67 / 0.35) 30%, oklch(0.72 0.1 70 / 0.18) 60%, transparent 80%", core: "oklch(0.78 0.08 72 / 0.55) 40%, oklch(0.7 0.12 68 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.58 0.17 0 / 0.25) 0%, oklch(0.58 0.17 0 / 0.08) 50%, transparent 75%", mid: "oklch(0.62 0.15 2 / 0.35) 30%, oklch(0.68 0.11 4 / 0.18) 60%, transparent 80%", core: "oklch(0.75 0.08 4 / 0.55) 40%, oklch(0.68 0.13 3 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.6 0.14 170 / 0.25) 0%, oklch(0.6 0.14 170 / 0.08) 50%, transparent 75%", mid: "oklch(0.65 0.12 172 / 0.35) 30%, oklch(0.7 0.09 174 / 0.18) 60%, transparent 80%", core: "oklch(0.76 0.07 175 / 0.55) 40%, oklch(0.7 0.1 173 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.62 0.16 72 / 0.25) 0%, oklch(0.62 0.16 72 / 0.08) 50%, transparent 75%", mid: "oklch(0.66 0.14 74 / 0.35) 30%, oklch(0.72 0.1 77 / 0.18) 60%, transparent 80%", core: "oklch(0.78 0.08 78 / 0.55) 40%, oklch(0.7 0.12 75 / 0.28) 70%, transparent 95%" },
  { outer: "oklch(0.6 0.15 285 / 0.25) 0%, oklch(0.6 0.15 285 / 0.08) 50%, transparent 75%", mid: "oklch(0.64 0.13 287 / 0.35) 30%, oklch(0.7 0.1 290 / 0.18) 60%, transparent 80%", core: "oklch(0.76 0.08 291 / 0.55) 40%, oklch(0.68 0.11 288 / 0.28) 70%, transparent 95%" },
];

function makeBg(stops: string): string {
  return `radial-gradient(circle at 50% 50%, ${stops})`;
}
const CYCLE = 20000;
function pickNext(prev: number): number {
  let n: number;
  do { n = Math.floor(Math.random() * HALO_STOPS.length); } while (n === prev);
  return n;
}

export function WaterSprite() {
  const { isOpen, openChat, chatState, expression } = useAssistant();
  const outerRef = useRef<HTMLSpanElement>(null);
  const midRef   = useRef<HTMLSpanElement>(null);
  const coreRef  = useRef<HTMLSpanElement>(null);

  const isStreaming = chatState.isStreaming;
  const expr: SpriteExpression = isStreaming ? "thinking" : (expression ?? "normal");

  const [switching, setSwitching] = useState(false);
  const [prevExpr,   setPrevExpr]   = useState<SpriteExpression>(expr);
  const prevExprRef = useRef(expr);
  const colorIdx = useRef(0);

  const applyColor = useCallback((idx: number) => {
    const c = HALO_STOPS[idx];
    if (outerRef.current) outerRef.current.style.background = makeBg(c.outer);
    if (midRef.current)   midRef.current.style.background   = makeBg(c.mid);
    if (coreRef.current)  coreRef.current.style.background  = makeBg(c.core);
  }, []);

  useEffect(() => {
    applyColor(colorIdx.current);
    const t = setInterval(() => { colorIdx.current = pickNext(colorIdx.current); applyColor(colorIdx.current); }, CYCLE);
    return () => clearInterval(t);
  }, [applyColor]);

  useEffect(() => {
    if (prevExprRef.current !== expr) {
      setPrevExpr(prevExprRef.current);
      setSwitching(true);
      prevExprRef.current = expr;
      const t = setTimeout(() => { setSwitching(false); setPrevExpr(expr); }, 500);
      return () => clearTimeout(t);
    }
  }, [expr]);

  if (isOpen) return null;

  const curExpr = switching ? prevExpr : expr;
  const imgSrc = `/DingDang/${DINGDANG_IMAGES[curExpr]}_lg.webp`;
  const nextSrc = switching ? `/DingDang/${DINGDANG_IMAGES[expr]}_lg.webp` : undefined;
  const sfx = isStreaming ? "-active" : "-idle";

  return (
    <button onClick={openChat} className="asst-sprite-btn" aria-label="打开水叮当助手">
      {/* 光环和角色都是按钮的直接子元素，共用同一坐标系(0,0→80,80) */}
      <span ref={outerRef} className={`asst-sprite-halo-outer asst-sprite-halo-outer${sfx}`} />
      <span ref={midRef}   className={`asst-sprite-halo-mid   asst-sprite-halo-mid${sfx}`}   />
      <span ref={coreRef}  className={`asst-sprite-halo-core  asst-sprite-halo-core${sfx}`}  />

      <span className={`asst-sprite-body asst-sprite-body${sfx}`}>
        <span className={`asst-sprite-shimmer asst-sprite-shimmer${sfx}`} />
        <img src={imgSrc} alt="水叮当"
          className={`asst-sprite-img-face ${switching ? "asst-sprite-img-out" : ""}`}
          style={{ borderRadius: "50%" }} />
        {switching && nextSrc && (
          <img src={nextSrc} alt="水叮当"
            className="asst-sprite-img-face asst-sprite-img-in"
            style={{ borderRadius: "50%" }} />
        )}
      </span>
    </button>
  );
}
