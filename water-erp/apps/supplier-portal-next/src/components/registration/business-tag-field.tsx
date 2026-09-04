"use client";

import { Check, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";

export type BusinessTagOption = {
  id: string;
  name: string;
};

type BusinessTagFieldProps = {
  value: string[];
  options: BusinessTagOption[];
  onChange: (value: string[]) => void;
  error?: string;
  min?: number;
  max?: number;
};

export function BusinessTagField({
  value,
  options,
  onChange,
  error,
  min = 2,
  max = 8,
}: BusinessTagFieldProps) {
  const fieldId = useId();
  const helperId = `${fieldId}-helper`;
  const errorId = `${fieldId}-error`;
  const [customValue, setCustomValue] = useState("");
  const [localError, setLocalError] = useState("");
  const optionNames = useMemo(() => new Set(options.map((option) => option.name)), [options]);
  const customTags = value.filter((tag) => !optionNames.has(tag));
  const message = error || localError;

  function commit(next: string[]) {
    const normalized = [...new Set(next.map((tag) => tag.trim()).filter(Boolean))];
    onChange(normalized);
    setLocalError("");
  }

  function toggle(tag: string) {
    if (value.includes(tag)) {
      commit(value.filter((item) => item !== tag));
      return;
    }
    if (value.length >= max) {
      setLocalError(`最多选择 ${max} 个业务标签`);
      return;
    }
    commit([...value, tag]);
  }

  function addCustomTag() {
    const tag = customValue.trim();
    if (!tag) {
      setLocalError("请输入自定义标签名称");
      return;
    }
    if (tag.length > 20) {
      setLocalError("标签不超过 20 个字符");
      return;
    }
    if (value.includes(tag)) {
      setLocalError("该标签已选择");
      return;
    }
    if (value.length >= max) {
      setLocalError(`最多选择 ${max} 个业务标签`);
      return;
    }
    commit([...value, tag]);
    setCustomValue("");
  }

  return (
    <div className={`reg-item reg-tag-field${message ? " has-error" : ""}`}>
      <div className="reg-tag-field__head">
        <label id={fieldId} className="reg-label">业务标签 <i>*</i></label>
        <span className="reg-tag-count">已选 {value.length} / {max}</span>
      </div>
      <p id={helperId} className="reg-field-helper">请选择 {min} 至 {max} 项，用于采购需求与供应商能力匹配。</p>

      <div className="reg-tagpool" role="group" aria-labelledby={fieldId} aria-describedby={`${helperId}${message ? ` ${errorId}` : ""}`}>
        {options.map((option) => {
          const selected = value.includes(option.name);
          return (
            <button
              key={option.id || option.name}
              type="button"
              className={`reg-tagpick${selected ? " on" : ""}`}
              aria-pressed={selected}
              onClick={() => toggle(option.name)}
            >
              {selected && <Check size={13} strokeWidth={2.3} aria-hidden="true" />}
              {option.name}
            </button>
          );
        })}
      </div>

      {customTags.length > 0 && (
        <div className="reg-tagpool reg-tagpool--custom" aria-label="自定义业务标签">
          {customTags.map((tag) => (
            <button key={tag} type="button" className="reg-tagpick reg-tagpick--custom on" aria-pressed="true" onClick={() => toggle(tag)}>
              <Check size={13} strokeWidth={2.3} aria-hidden="true" />
              {tag}<em className="reg-tagbadge">待审核</em>
            </button>
          ))}
        </div>
      )}

      <div className="reg-custom-tag-row">
        <input
          className="reg-inp"
          value={customValue}
          maxLength={20}
          aria-label="自定义业务标签"
          placeholder="未找到合适标签？输入自定义标签"
          onChange={(event) => {
            setCustomValue(event.target.value);
            setLocalError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomTag();
            }
          }}
        />
        <button type="button" className="reg-btn reg-btn--ghost-sm" onClick={addCustomTag}>
          <Plus size={14} aria-hidden="true" />添加标签
        </button>
      </div>

      {message && <span id={errorId} className="reg-error-text" role="alert">{message}</span>}
    </div>
  );
}
