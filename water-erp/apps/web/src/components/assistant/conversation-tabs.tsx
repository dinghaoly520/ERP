"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Conversation } from "./types";

interface ConversationTabsProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** "page" uses wider bar; "mini" uses inline bar */
  variant?: "page" | "mini";
}

const SCROLL_AMOUNT = 200;

export function ConversationTabs({
  conversations,
  activeId,
  onSelect,
  onDelete,
  variant = "mini",
}: ConversationTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // First check after a frame to ensure DOM is painted
    const frame = requestAnimationFrame(() => updateScrollState());
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [conversations, updateScrollState]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT, behavior: "smooth" });
  };

  if (conversations.length <= 1) return null;

  const isPage = variant === "page";

  return (
    <div className={`asst-conv-tabs-wrap ${isPage ? "asst-conv-tabs-wrap-page" : ""}`}>
      <button
        className={`asst-conv-scroll-btn ${!canScrollLeft ? "asst-conv-scroll-btn-disabled" : ""}`}
        onClick={() => scroll("left")}
        disabled={!canScrollLeft}
        aria-label="向左滚动"
      >
        <ChevronLeft size={14} strokeWidth={1.5} />
      </button>
      <div
        ref={scrollRef}
        className={isPage ? "asst-page-tabs" : "asst-panel-tabs"}
      >
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`asst-conv-tab${isActive ? " asst-conv-tab-active" : ""}`}
            >
              <span className="truncate max-w-[4em]">{conv.title}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="asst-conv-tab-delete"
                aria-label={`删除对话"${conv.title}"`}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      <button
        className={`asst-conv-scroll-btn ${!canScrollRight ? "asst-conv-scroll-btn-disabled" : ""}`}
        onClick={() => scroll("right")}
        disabled={!canScrollRight}
        aria-label="向右滚动"
      >
        <ChevronRight size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
