"use client";

import { HelpCircle } from "lucide-react";
import { useState } from "react";

/**
 * 「?」悬停说明（2026-09-21 文案收敛改造）
 * 长说明不再常驻页面：hover / 聚焦 / 点击图标时以气泡显示。
 */
export function HelpTip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`help-tip ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="help-tip__trigger"
        aria-label={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
      >
        <HelpCircle size={13} strokeWidth={1.5} />
      </button>
      <span className="help-tip__bubble" role="tooltip" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
