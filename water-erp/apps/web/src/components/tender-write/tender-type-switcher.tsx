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
              "rounded-[8px] px-3.5 py-2 text-sm font-semibold transition-all duration-200",
              active
                ? "bg-[oklch(0.96_0.008_258)] text-[color:var(--foreground)]"
                : "neu-btn-soft",
            ].join(" ")}
            style={active ? {
              boxShadow: "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15), inset -2px -2px 5px oklch(1 0 0 / 0.5)",
              border: "none",
            } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
