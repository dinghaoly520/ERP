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
              "rounded-full border px-3.5 py-2 text-sm font-semibold transition-all duration-200",
              active
                ? "border-[rgba(96,139,239,0.26)] bg-[rgba(96,139,239,0.12)] text-[color:var(--accent)] shadow-[0_8px_18px_rgba(78,110,168,0.08)]"
                : "border-white/55 bg-white/72 text-[color:var(--muted-foreground)] hover:border-white/80 hover:bg-white/90 hover:text-[color:var(--foreground)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
