"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
};

export function PasswordField({
  label,
  value,
  onChange,
  error,
  placeholder = "请输入密码",
  autoComplete = "new-password",
  required = false,
}: PasswordFieldProps) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div className={`reg-item${error ? " has-error" : ""}`}>
      <label className="reg-label" htmlFor={generatedId}>{label}{required && <i> *</i>}</label>
      <div className="pwd-iw">
        <input
          id={generatedId}
          className="pwd-inp"
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={`pwd-eye${visible ? " on" : ""}`}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      {error && <span id={errorId} className="reg-error-text" role="alert">{error}</span>}
    </div>
  );
}
