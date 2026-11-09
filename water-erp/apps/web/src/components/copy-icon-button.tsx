"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

/**
 * 值右侧统一复制图标按钮（2026-11-09 用户裁定：身份证号/手机号/邮箱/统一社会信用代码
 * 等身份联系类信息一律显式图标复制，供应商/专家管理全模块同款）。
 * - 明文字段传 value 直接复制；掩码字段传 getText 异步取明文（走 reveal 端点，服务端
 *   留审计），不复制掩码串；
 * - 点击自带 stopPropagation：表格行/卡片多为可点跳转，防误触；
 * - 成功后图标变对勾 1.2 秒；结果以 toast 反馈（http 演示环境走降级，可能失败）。
 */
export function CopyIconButton({ value, getText, label, className = "" }: {
  /** 展示值即复制值（明文字段） */
  value?: string | null;
  /** 异步取明文（掩码字段：reveal 端点取真值，留审计） */
  getText?: () => Promise<string | null | undefined>;
  /** 字段名：toast/title 用 */
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  // done→idle 回落定时器：卸载即清（防迟到的 setState 打在已卸载实例上）
  const doneTimer = useRef<number | null>(null);
  useEffect(() => () => { if (doneTimer.current !== null) window.clearTimeout(doneTimer.current); }, []);
  const plain = !!value && !!value.trim();

  async function handle(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (state !== "idle" || (!getText && !plain)) return;
    setState("busy");
    try {
      const text = ((getText ? await getText() : value) ?? "").trim();
      if (!text) {
        toast.error(`${label}暂无内容，无法复制`);
        setState("idle");
        return;
      }
      if (await copyToClipboard(text)) {
        toast.success(`${label}已复制${getText ? "（本次查看明文已记录）" : ""}`);
        setState("done");
        if (doneTimer.current !== null) window.clearTimeout(doneTimer.current);
        doneTimer.current = window.setTimeout(() => setState("idle"), 1200);
      } else {
        toast.error("复制失败，请手动选择复制");
        setState("idle");
      }
    } catch (err: any) {
      toast.error(err?.message || `${label}复制失败`);
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={state === "busy" || (!getText && !plain)}
      aria-label={`复制${label}`}
      title={`复制${label}${getText ? "（将记录明文查看）" : ""}`}
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-all hover:text-[var(--accent)] active:scale-90 disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {state === "busy" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={12} className="text-[var(--success)]" />
      ) : (
        <Copy size={12} />
      )}
    </button>
  );
}
