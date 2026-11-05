'use client';

import { TypeaheadCombobox } from '@/components/workbench/typeahead-combobox';

/**
 * 部门联想输入（typeahead，2026-11-02；2026-11-05 薄壳化——实现在通用
 * TypeaheadCombobox）：触发器即输入框（workbench-input 单框，无框内嵌套），
 * 可打字过滤、可键盘选、可自由输入新部门（提交侧找/建本公司部门）。
 */
export function DepartmentCombobox({
  value,
  onChange,
  options,
  placeholder = '选择或输入部门',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
}) {
  return (
    <TypeaheadCombobox
      value={value}
      onChange={onChange}
      options={options.map((d) => d.name)}
      allowCustom
      placeholder={placeholder}
      emptyText="本公司暂无部门记录，直接输入即为新建"
    />
  );
}
