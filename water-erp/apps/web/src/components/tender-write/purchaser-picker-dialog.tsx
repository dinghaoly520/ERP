"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, UserRound, UserRoundCheck, X } from "lucide-react";
import { getCompanyInfoOnce, type CompanyPurchaserEntry } from "@/lib/api/company-info";

/**
 * 采购人选择器（2026-10-10 多人版）：采购文件编写「联系人」按钮的数据源——
 * 从公司信息管理维护的采购人条目中单选（选即同时填 联系人/联系电话/联系邮箱）。
 * 条目维护归公司信息管理页（leader），此处只读选择；空态引导去维护。
 */
export function PurchaserPickerDialog({
  isOpen,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  onSelect: (purchaser: { name: string; email: string; phone: string }) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CompanyPurchaserEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEntries(null);
    setError(null);
    void getCompanyInfoOnce().then((ci) => {
      if (ci) setEntries(ci.purchasers ?? []);
      else setError("未取到本公司信息（可能未归属公司或未维护）");
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const inputHint = "公司信息管理（侧栏 → 资源管理）中由负责人维护采购人条目后，此处即可选择";

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-[460px] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <div className="px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">选择采购人</div>
            <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {entries === null && !error ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              正在加载...
            </div>
          ) : error ? (
            <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {error}
            </div>
          ) : (entries ?? []).length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <div className="text-sm text-[color:var(--foreground)]">本公司暂未维护采购人</div>
              <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">{inputHint}</div>
            </div>
          ) : (
            <div className="space-y-2">
              {(entries ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelect({ name: p.name, email: p.email ?? "", phone: p.phone ?? "" });
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--border)] px-4 py-3 text-left transition-colors hover:border-[rgba(76,111,189,0.5)] hover:bg-[rgba(96,139,239,0.06)]"
                >
                  <div
                    className={`rounded-[8px] border p-2 ${
                      p.isDefault
                        ? "border-[rgba(76,111,189,0.55)] bg-[rgba(96,139,239,0.16)]"
                        : "border-[rgba(96,139,239,0.18)] bg-[rgba(96,139,239,0.08)]"
                    }`}
                  >
                    {p.isDefault ? (
                      <UserRoundCheck size={14} className="text-[color:var(--accent)]" />
                    ) : (
                      <UserRound size={14} className="text-[color:var(--accent)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                      {p.name}
                      {p.isDefault && <span className="ml-2 text-[10px] font-medium text-[color:var(--accent)]">默认</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted-foreground)]">
                      {p.phone || "未填电话"}
                      {p.email ? <span className="mx-1.5">·</span> : null}
                      {p.email || ""}
                    </div>
                  </div>
                </button>
              ))}
              <p className="pt-1 text-[11px] leading-4 text-[color:var(--muted-foreground)]">{inputHint}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
