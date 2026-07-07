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
                ? "neu-btn-primary"
                : "neu-btn-soft",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
