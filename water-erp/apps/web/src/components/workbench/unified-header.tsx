"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface UnifiedHeaderProps {
  /** Page title (optional — brand is already shown in sidebar) */
  title?: string;
  /** Optional description/subtitle */
  description?: string;
  /** Optional right-side actions */
  actions?: ReactNode;
  /** Show "返回首页" back link */
  showBack?: boolean;
  /** Custom back link href */
  backHref?: string;
  /** Custom back link text */
  backLabel?: string;
}

/**
 * UnifiedHeader — a slim glass header bar for the main content area.
 *
 * The brand logo + "智慧水发·采购中心" live in the left sidebar (AppShell);
 * this header intentionally does NOT repeat them. It only renders an optional
 * page title, description, back-link, and right-side actions.
 */
export function UnifiedHeader({
  title,
  description,
  actions,
  showBack = false,
  backHref = "/dashboard",
  backLabel = "返回首页",
}: UnifiedHeaderProps) {
  // If there's nothing to show, render nothing — keeps the layout clean.
  if (!title && !description && !actions && !showBack) {
    return null;
  }

  return (
    <header className="flow-header">
      <div className="flex min-w-0 items-center gap-3">
        {showBack && (
          <Link href={backHref} className="flow-back shrink-0">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flow-back-arrow"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {backLabel}
          </Link>
        )}

        {title && (
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">
              {title}
            </h1>
            {description && (
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)] line-clamp-1">
                {description}
              </p>
            )}
          </div>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
