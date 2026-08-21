"use client";

import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { fetchCurrentUser } from "@/lib/api/auth";
import { api } from "@/lib/api";

/**
 * admin 专用公司选择器（公司级数据隔离，2026-08-20）。
 * 默认「全部公司」；选择挂 URL query（?companyId=，可分享/刷新保持）+ localStorage 记忆。
 * 非 admin 不渲染——后端对其传参一律忽略，双保险。
 */
export const COMPANY_STORAGE_KEY = "companyFilter";

export function readInitialCompanyId(): string {
  if (typeof window === "undefined") return "all";
  const url = new URLSearchParams(window.location.search).get("companyId");
  if (url) return url;
  return window.localStorage.getItem(COMPANY_STORAGE_KEY) || "all";
}

interface CompanyOption {
  id: string;
  name: string;
  shortName: string | null;
  _count: { users: number };
}

export function CompanySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (companyId: string) => void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [options, setOptions] = useState<CompanyOption[] | null>(null);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setRole(u.role))
      .catch(() => setRole("anonymous"));
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    api
      .get<CompanyOption[]>("/companies")
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [role]);

  if (role !== "admin") return null;

  const handleChange = (next: string) => {
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("companyId");
    else url.searchParams.set("companyId", next);
    window.history.replaceState(null, "", url.toString());
    window.localStorage.setItem(COMPANY_STORAGE_KEY, next);
    onChange(next);
  };

  return (
    <label className="neu-chip flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
      <Building2 size={13} strokeWidth={1.8} className="text-[var(--muted-foreground)]" />
      <span className="text-[var(--muted-foreground)]">公司</span>
      {options === null ? (
        <Loader2 size={12} className="animate-spin text-[var(--muted-foreground)]" />
      ) : (
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="bg-transparent text-[11px] font-medium text-[var(--foreground)] outline-none"
          aria-label="选择查看的公司"
        >
          <option value="all">全部公司</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortName ? `${c.shortName} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
