import type {
  TenderDocumentType,
  TenderDocumentTypeMeta,
} from "@/lib/types/tender-write";

/** 方式分组（2026-11-24 用户裁定）：邀请招标/公开招标归「招标」，其余四方式归「采购」
 *  （采购组须显式排除招标两方式——兜底全量匹配会把它们重复带进采购组） */
const BIDDING_GROUP_TYPES = new Set<TenderDocumentType>(["INVITED_BIDDING", "PUBLIC_BIDDING"]);
const GROUPS: { key: string; label: string; match: (t: TenderDocumentType) => boolean }[] = [
  { key: "bidding", label: "招标", match: (t) => BIDDING_GROUP_TYPES.has(t) },
  { key: "procurement", label: "采购", match: (t) => !BIDDING_GROUP_TYPES.has(t) },
];

export function TenderTypeSwitcher({
  options,
  selectedType,
  onSelect,
}: {
  options: TenderDocumentTypeMeta[];
  selectedType: TenderDocumentType | null;
  onSelect: (type: TenderDocumentType) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {GROUPS.map((group, gi) => {
        const groupOptions = options.filter((o) => group.match(o.type));
        if (groupOptions.length === 0) return null;
        return (
          <div key={group.key} className="flex items-center gap-2">
            {/* 组标签：内凹瓷片（非点击项） */}
            <span
              className="shrink-0 rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_9%,transparent)] px-2 py-1.5 text-[10px] font-bold tracking-[0.08em] text-[color:var(--accent)]"
              aria-hidden
            >
              {group.label}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {groupOptions.map((option) => {
                const active = option.type === selectedType;

                return (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => onSelect(option.type)}
                    className={[
                      "rounded-[8px] px-3.5 py-2 text-xs font-semibold transition-all duration-200",
                      active
                        ? "bg-[color-mix(in_oklch,var(--accent-soft)_55%,transparent)] text-[color:var(--accent)]"
                        : "text-[color:var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_40%,transparent)]",
                    ].join(" ")}
                    style={active ? {
                      boxShadow: "inset 1px 2px 3px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.4)",
                    } : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {/* 组间细分隔线（末组后不画） */}
            {gi < GROUPS.length - 1 && (
              <span className="h-5 w-px bg-[oklch(0.6_0.04_258/0.16)]" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}
