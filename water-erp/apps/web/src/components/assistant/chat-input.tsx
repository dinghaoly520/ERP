"use client";

import { useState, useCallback, type KeyboardEvent } from "react";
import { Mic } from "lucide-react";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="asst-input-area">
      <div className="asst-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问水叮当..."
          disabled={disabled}
          rows={1}
          className="asst-input"
          style={{ maxHeight: 100 }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
          }}
        />
        <button
          disabled={disabled}
          className="asst-input-mic-btn"
          aria-label="语音输入"
          title="语音输入"
        >
          <Mic size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="asst-input-btn"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8L14 2L10 14L8 9L2 8Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
