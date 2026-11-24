"use client";

import { useMemo, type ReactNode } from "react";
import { SearchSelect, type SearchSelectOption } from "./search-select";

/**
 * 原生 select 的瓷片化直接替换（2026-11-24 全系统下拉统一裁定）。
 *
 * 动机：macOS 原生 <select> 弹层与选中项对齐绘制、盖住触发框且无法锚定位置；
 * 且原生灰框与 cgzxui 瓷片语言不一致。全系统下拉统一为自绘形态（弹层恒在框下方、
 * 当前值白瓷片凸起+对勾、>8 项自动带搜索行）。
 *
 * API 镜像原生 select：子元素写 <option>，onChange 回传 { target: { value } } 假事件
 * ——既有受控绑定与处理器（e.target.value / 解析分支）零改动，迁移只改标签名：
 *
 *   <NeuSelect value={v} onChange={(e) => setV(e.target.value)} className="min-w-[120px]" disabled={!ok}>
 *     <option value="">全部</option>
 *     {list.map((x) => <option key={x} value={x}>{x}</option>)}
 *   </NeuSelect>
 *
 * 约定：单值受控（全库原生 select 无 multiple/optgroup/defaultValue，2026-11-24 盘点）；
 * <option> 无 value 时取文本（同原生）；className 只承载宽度约束（w-、min-w- 类），
 * 视觉（高 38px 内凹瓷片）由组件统一——旧 workbench-input/neu-input 外观类迁移时剥除。
 */
export function NeuSelect({
  value,
  onChange,
  children,
  disabled = false,
  className = "",
  title,
  autoFocus = false,
  "aria-label": ariaLabel,
}: {
  value: string | number | null | undefined;
  onChange?: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  /** 宽度约束等布局类（透传触发器外层）；输入框外观类勿传 */
  className?: string;
  title?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  return (
    <SearchSelect
      options={options}
      value={value == null ? "" : String(value)}
      onPick={(o) => onChange?.({ target: { value: o.value } })}
      disabled={disabled}
      triggerClassName={className}
      title={title}
      ariaLabel={ariaLabel}
      autoFocus={autoFocus}
    />
  );
}

/** 从 <option> 子元素收集选项：value 缺省取文本（同原生语义）；忽略非 option 节点 */
function collectOptions(children: ReactNode): SearchSelectOption[] {
  const out: SearchSelectOption[] = [];
  const walk = (node: ReactNode) => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = node as any;
    if (el.type === "option") {
      const label = textOf(el.props?.children as ReactNode);
      const explicit = el.props?.value;
      out.push({ value: explicit != null ? String(explicit) : label, label });
      return;
    }
    if (el.props?.children != null) walk(el.props.children as ReactNode);
  };
  walk(children);
  return out;
}

/** ReactNode 文本化（字符串/数字/嵌套数组拼接）——option 取值兜底与展示用 */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = node as any;
  if (el.props?.children != null) return textOf(el.props.children as ReactNode);
  return "";
}
