import type {
  TenderDocumentType,
  TenderDocumentTypeMeta,
} from "@/lib/types/tender-write";

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
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option) => {
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
  );
}
