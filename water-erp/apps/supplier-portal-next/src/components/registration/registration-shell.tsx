"use client";

import type { LucideIcon } from "lucide-react";
import { Check, LogIn } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cloneElement, Fragment, isValidElement, type ReactNode } from "react";

export type RegistrationStep = {
  label: string;
  description: string;
};

type RegistrationControlProps = {
  id?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
};

type RegistrationFieldProps = {
  id: string;
  label: string;
  children: ReactNode;
  error?: string;
  required?: boolean;
};

export function RegistrationField({ id, label, children, error, required = false }: RegistrationFieldProps) {
  const errorId = `${id}-error`;
  const isNativeControl = isValidElement<RegistrationControlProps>(children)
    && typeof children.type === "string"
    && ["input", "select", "textarea"].includes(children.type);
  const describedBy = isNativeControl
    ? [children.props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined
    : undefined;
  const control = isNativeControl
    ? cloneElement(children, {
        id: children.props.id ?? id,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={`reg-item${error ? " has-error" : ""}`}>
      <label className="reg-label" htmlFor={id}>{label}{required && <i> *</i>}</label>
      {control}
      {error && <span id={errorId} className="reg-error-text" role="alert">{error}</span>}
    </div>
  );
}

type RegistrationStepperProps = {
  steps: RegistrationStep[];
  currentStep: number;
  maxVisitedStep: number;
  onStepChange: (step: number) => void;
};

export function RegistrationStepper({
  steps,
  currentStep,
  maxVisitedStep,
  onStepChange,
}: RegistrationStepperProps) {
  const current = steps[currentStep] ?? steps[0];

  return (
    <>
      <nav className="reg-steps reg-steps--desktop" aria-label="注册进度">
        {steps.map((item, index) => {
          const isActive = index === currentStep;
          const isDone = index < currentStep || (index !== currentStep && index <= maxVisitedStep);
          const canVisit = index <= maxVisitedStep;

          return (
            <Fragment key={item.label}>
              {index > 0 && (
                /* 段落式连线：凹槽（未达）→ 凸起光带（已过），节点间隔出段落感 */
                <div className={`reg-seg${index <= currentStep ? " is-filled" : ""}`} aria-hidden="true">
                  <span className="reg-seg-fill">
                    <span className="reg-seg-sheen" />
                  </span>
                </div>
              )}
              <button
                type="button"
                className={`reg-step${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
                disabled={!canVisit}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${index + 1}. ${item.label}${isDone ? "，已完成" : ""}`}
                onClick={() => canVisit && onStepChange(index)}
              >
                <span className="reg-step-dot" aria-hidden="true">
                  {isDone ? <Check size={16} strokeWidth={2.5} /> : <span className="reg-step-num">{index + 1}</span>}
                </span>
                <span className="reg-step-label">{item.label}</span>
              </button>
            </Fragment>
          );
        })}
      </nav>

      <div className="reg-steps-mobile" aria-live="polite">
        <div className="reg-steps-mobile__copy">
          <span>第 {currentStep + 1} / {steps.length} 步</span>
          <strong>{current.label}</strong>
          <small>{current.description}</small>
        </div>
        <div className="reg-steps-mobile__track" aria-hidden="true">
          <span style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </>
  );
}

type RegistrationShellProps = RegistrationStepperProps & {
  title: string;
  subtitle: string;
  notice?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  formLabel?: string;
};

export function RegistrationShell({
  title,
  subtitle,
  notice,
  children,
  actions,
  formLabel = title,
  ...stepperProps
}: RegistrationShellProps) {
  return (
    <main className="reg reg-page reg--supplier">
      <div className="reg-bg" aria-hidden="true" />

      <Link className="reg-brand" href="/login" aria-label="返回供应商门户登录页">
        <Image src="/logo.png" alt="" width={54} height={54} className="reg-brand-mark" priority />
        <span className="reg-brand-name">智慧水发 · 蜀水云采</span>
      </Link>

      <section className="reg-panel" aria-label={formLabel}>
        <div className="reg-card">
          <header className="reg-head">
            <p className="reg-brand-word">智慧水发<span className="reg-dot">·</span>蜀水云采</p>
            <div className="reg-divider" aria-hidden="true">◆</div>
            <h1 className="reg-title">{title}</h1>
            <p className="reg-sub">{subtitle}</p>
          </header>

          {notice}
          <RegistrationStepper {...stepperProps} />
          <div className="reg-body">{children}</div>
          <div className="reg-actions">{actions}</div>
          <div className="reg-foot">
            <span className="reg-foot-text">已有账号？</span>
            <Link href="/login" className="reg-foot-link">
              <LogIn size={14} strokeWidth={1.9} aria-hidden="true" />
              返回登录
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

type RegistrationSectionProps = {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function RegistrationSection({
  icon: Icon,
  title,
  hint,
  children,
  className = "",
}: RegistrationSectionProps) {
  return (
    <section className={`reg-module${className ? ` ${className}` : ""}`}>
      <div className="reg-mod-head">
        <span className="reg-mod-icon" aria-hidden="true">
          <Icon size={17} strokeWidth={1.7} />
        </span>
        <h2 className="reg-mod-title">{title}</h2>
        {hint && <p className="reg-mod-hint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
