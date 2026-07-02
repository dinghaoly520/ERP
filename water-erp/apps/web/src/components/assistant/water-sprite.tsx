"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAssistant } from "./assistant-provider";
import { DINGDANG_IMAGES, type SpriteExpression } from "./sprite-images";

const HALO_STOPS: Array<{ outer: string; mid: string; core: string }> = [
  { outer: "rgba(120,170,255,0.25) 0%, rgba(120,170,255,0.08) 50%, transparent 75%", mid: "rgba(140,180,255,0.35) 30%, rgba(160,210,255,0.18) 60%, transparent 80%", core: "rgba(180,220,255,0.55) 40%, rgba(140,200,255,0.28) 70%, transparent 95%" },
  { outer: "rgba(160,130,255,0.25) 0%, rgba(160,130,255,0.08) 50%, transparent 75%", mid: "rgba(170,140,255,0.35) 30%, rgba(190,170,255,0.18) 60%, transparent 80%", core: "rgba(200,180,255,0.55) 40%, rgba(160,140,255,0.28) 70%, transparent 95%" },
  { outer: "rgba(100,200,240,0.25) 0%, rgba(100,200,240,0.08) 50%, transparent 75%", mid: "rgba(120,210,245,0.35) 30%, rgba(140,220,250,0.18) 60%, transparent 80%", core: "rgba(160,230,255,0.55) 40%, rgba(120,210,245,0.28) 70%, transparent 95%" },
  { outer: "rgba(255,170,100,0.25) 0%, rgba(255,170,100,0.08) 50%, transparent 75%", mid: "rgba(255,180,110,0.35) 30%, rgba(255,200,140,0.18) 60%, transparent 80%", core: "rgba(255,210,160,0.55) 40%, rgba(255,180,110,0.28) 70%, transparent 95%" },
  { outer: "rgba(255,130,180,0.25) 0%, rgba(255,130,180,0.08) 50%, transparent 75%", mid: "rgba(255,140,190,0.35) 30%, rgba(255,170,210,0.18) 60%, transparent 80%", core: "rgba(255,190,220,0.55) 40%, rgba(255,150,200,0.28) 70%, transparent 95%" },
  { outer: "rgba(120,220,180,0.25) 0%, rgba(120,220,180,0.08) 50%, transparent 75%", mid: "rgba(130,225,185,0.35) 30%, rgba(150,235,200,0.18) 60%, transparent 80%", core: "rgba(170,240,210,0.55) 40%, rgba(130,225,185,0.28) 70%, transparent 95%" },
  { outer: "rgba(255,180,80,0.25) 0%, rgba(255,180,80,0.08) 50%, transparent 75%", mid: "rgba(255,190,90,0.35) 30%, rgba(255,210,130,0.18) 60%, transparent 80%", core: "rgba(255,220,160,0.55) 40%, rgba(255,190,90,0.28) 70%, transparent 95%" },
  { outer: "rgba(180,140,255,0.25) 0%, rgba(180,140,255,0.08) 50%, transparent 75%", mid: "rgba(190,150,255,0.35) 30%, rgba(210,180,255,0.18) 60%, transparent 80%", core: "rgba(220,190,255,0.55) 40%, rgba(190,150,255,0.28) 70%, transparent 95%" },
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
