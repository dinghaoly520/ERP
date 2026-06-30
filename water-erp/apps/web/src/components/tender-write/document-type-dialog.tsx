"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { TenderDocumentTypeMeta } from "@/lib/types/tender-write";

export function DocumentTypeDialog({
  isOpen,
  options,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  options: TenderDocumentTypeMeta[];
  onConfirm: (type: TenderDocumentTypeMeta["type"]) => void;
  onClose: () => void;
}) {
  const [pendingType, setPendingType] = useState<TenderDocumentTypeMeta["type"] | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      setPendingType(null);
    }
  }, [isOpen]);

  const selectedOption = useMemo(
    () => options.find((option) => option.type === pendingType) ?? null,
    [options, pendingType],
  );

  // Use consistent disabled state for SSR
  const isDisabled = mounted ? pendingType === null : true;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-[rgba(242,246,255,0.42)] backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-[720px] rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,248,255,0.88))] shadow-[0_24px_64px_rgba(59,89,143,0.16)]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/60 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
              选择招标文件类型
            </h2>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              请选择本次要创建的采购文件类型
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/70 bg-white/80 p-2 text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
            aria-label="关闭文件类型选择弹窗"
          >
            <X size={16} />
          </button>
        </div>

        {/* Options List */}
        <div className="px-6 py-5">
          <div className="space-y-2">
            {options.map((option) => {
              const isSelected = pendingType === option.type;
              const isReady = option.availability === "ready";

              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => setPendingType(option.type)}
                  onDoubleClick={() => {
                    setPendingType(option.type);
                    onConfirm(option.type);
                  }}
                  className={[
                    "flex w-full items-start gap-4 rounded-xl px-4 py-4 text-left transition",
                    isSelected
                      ? "bg-[color:var(--primary)]/[0.06] ring-1 ring-[color:var(--primary)]/[0.3]"
                      : "hover:bg-white/60",
                  ].join(" ")}
                  aria-pressed={isSelected}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] font-medium text-[color:var(--foreground)]">
                        {option.label}
                      </span>
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                          isReady
                            ? "bg-[rgba(92,181,150,0.12)] text-[color:var(--success)]"
                            : "bg-[rgba(234,191,106,0.16)] text-[color:var(--warning)]",
                        ].join(" ")}
                      >
                        {isReady ? "完整支持" : "草稿模式"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                      {option.description}
                    </p>
                  </div>
                  {isSelected ? (
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--primary)] text-white">
                      <Check size={12} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-white/60 px-6 py-4">
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
              if (pendingType) {
                onConfirm(pendingType);
              }
            }}
            className="rounded-full bg-[color:var(--primary)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            创建草稿
          </button>
        </div>
      </div>
    </div>
  );
}
