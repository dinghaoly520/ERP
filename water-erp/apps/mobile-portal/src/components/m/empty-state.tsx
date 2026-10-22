import { Inbox } from "lucide-react";

/** 空态——无数据时显文案不隐藏区块（无 mock fallback 铁律） */
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
      <Inbox size={22} className="text-[color-mix(in_oklch,var(--muted-foreground)_60%,transparent)]" />
      <p className="text-[14px] text-[var(--muted-foreground)]">{text}</p>
    </div>
  );
}
