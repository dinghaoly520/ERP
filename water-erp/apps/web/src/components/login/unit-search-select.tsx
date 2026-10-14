"use client";

import { useMemo } from "react";
import { SearchSelect } from "@/components/workbench/search-select";
import { SASAC_UNITS } from "@/lib/data/sasac-units";

/**
 * 集团单位选择器（:3005 版）：62 家全级次企业名单。
 * 2026-10-14 起为通用 SearchSelect（cgzxui 下拉选择器规范形态）的薄包装——
 * 视觉/交互规范单一源见 components/workbench/search-select.tsx。
 */
export function UnitSearchSelect({
  value,
  onChange,
  placeholder = "选择或输入公司名称",
  allowCustom = true,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 允许手输不在名单中的公司（注册场景需要）；国资提取场景关闭 */
  allowCustom?: boolean;
  className?: string;
}) {
  const options = useMemo(() => SASAC_UNITS.map((u) => ({ value: u.name, label: u.name })), []);
  return (
    <SearchSelect
      options={options}
      value={value}
      onPick={(o) => onChange(o.value)}
      placeholder={placeholder}
      searchPlaceholder="搜索公司…"
      emptyText="无匹配公司"
      allowCustom={allowCustom}
      triggerClassName={className}
      panelMinWidth={260}
    />
  );
}
