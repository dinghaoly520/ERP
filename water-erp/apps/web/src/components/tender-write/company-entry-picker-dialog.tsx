"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin, ShieldAlert, X } from "lucide-react";
import { getCompanyInfoOnce } from "@/lib/api/company-info";

/**
 * 公司条目选择器（2026-10-10 多条目版）：开标地点 / 监督举报——
 * 从公司信息管理维护的条目中单选（默认条目置顶标徽）。
 * - kind="place"：选中回调整条地址（写入「开标地点」字段）
 * - kind="supervision"：选中回调整块方案（写入监督四字段）
 * 条目维护归公司信息管理页（leader），此处只读选择；空态引导去维护。
 */
type SupervisionProfileValue = { department: string; address: string; contact: string; phone: string };

export function CompanyEntryPickerDialog({
  isOpen,
  kind,
  onSelectPlace,
  onSelectSupervision,
  onClose,
}: {
  isOpen: boolean;
  kind: "place" | "supervision";
  onSelectPlace?: (address: string) => void;
  onSelectSupervision?: (profile: SupervisionProfileValue) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<{ id: string; label: string; isDefault: boolean; line: string; raw?: SupervisionProfileValue }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setItems(null);
    setError(null);
    void getCompanyInfoOnce().then((ci) => {
      if (!ci) {
        setError("未取到本公司信息（可能未归属公司或未维护）");
        return;
      }
      if (kind === "place") {
        setItems(
          (ci.places ?? []).map((p) => ({ id: p.id, label: p.label, isDefault: p.isDefault, line: p.address })),
        );
      } else {
        setItems(
          (ci.supervisionProfiles ?? []).map((p) => {
            const value: SupervisionProfileValue = {
              department: p.department ?? "",
              address: p.address ?? "",
              contact: p.contact ?? "",
              phone: p.phone ?? "",
            };
            // 以监督人为条目标识（2026-10-10 用户裁定：无方案名称列）；副行展示部门与电话
            const parts = [p.department, p.phone].filter(Boolean);
            return { id: p.id, label: p.contact || "监督方案", isDefault: p.isDefault, line: parts.join(" · "), raw: value };
          }),
        );
      }
    });
  }, [isOpen, kind]);

  if (!isOpen) return null;

  const pick = (item: { line: string; raw?: SupervisionProfileValue }) => {
    if (kind === "place") onSelectPlace?.(item.line);
    else if (item.raw) onSelectSupervision?.(item.raw);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-[500px] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <div className="px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
              {kind === "place" ? <MapPin size={14} /> : <ShieldAlert size={14} />}
              {kind === "place" ? "选择开标地点" : "选择监督举报"}
            </div>
            <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {items === null && !error ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              正在加载...
            </div>
          ) : error ? (
            <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {error}
            </div>
          ) : (items ?? []).length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <div className="text-sm text-[color:var(--foreground)]">
                本公司暂未维护{kind === "place" ? "开标地点" : "监督方案"}条目
              </div>
              <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                请到 公司信息管理（侧栏 → 资源管理）由负责人维护条目后，此处即可选择
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {(items ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pick(item)}
                  className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--border)] px-4 py-3 text-left transition-colors hover:border-[rgba(76,111,189,0.5)] hover:bg-[rgba(96,139,239,0.06)]"
                >
                  <div
                    className={`rounded-[8px] border p-2 ${
                      item.isDefault
                        ? "border-[rgba(76,111,189,0.55)] bg-[rgba(96,139,239,0.16)]"
                        : "border-[rgba(96,139,239,0.18)] bg-[rgba(96,139,239,0.08)]"
                    }`}
                  >
                    {kind === "place" ? (
                      <MapPin size={14} className="text-[color:var(--accent)]" />
                    ) : (
                      <ShieldAlert size={14} className="text-[color:var(--accent)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                      {item.label}
                      {item.isDefault && <span className="ml-2 text-[10px] font-medium text-[color:var(--accent)]">默认</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted-foreground)]">{item.line}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
