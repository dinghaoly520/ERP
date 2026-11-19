"use client";

import type { ComponentType } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * 子页页头（2026-11-19 九页统一版式）：白瓷条三栏网格——返回钮贴左缘、
 * 「图标井+标题」组整体居中、右栏等宽占位保真居中。返回与标题组拉开呼吸，
 * 不再并排挤在左端（用户裁定：挨着难看，从整体考虑重排）。
 */
export function PageHeader({
  title,
  icon: Icon,
  color = "var(--accent)",
}: {
  title: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  color?: string;
}) {
  const router = useRouter();
  return (
    <div className="m-pagebar mb-3 grid grid-cols-[2.5rem_1fr_2.5rem] items-center px-2 py-2">
      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        aria-label="返回驾驶舱"
        className="neu-btn-soft h-9 w-9 justify-self-start rounded-[11px] p-0 active:scale-95"
      >
        <ArrowLeft size={15} />
      </button>
      <span className="flex min-w-0 items-center justify-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}
        >
          <Icon size={15} strokeWidth={1.5} />
        </span>
        <span className="truncate text-[17px] font-bold tracking-[-0.02em] text-[var(--foreground)]">{title}</span>
      </span>
      <span aria-hidden />
    </div>
  );
}
