'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PublicAssistantAvatar } from './avatar';
import { PublicAssistantMessage } from './message';
import { PublicAssistantWelcome } from './welcome';
import type { PublicAssistantContext, PublicAssistantMessage as Message } from './types';

interface PublicAssistantDialogProps {
  open: boolean;
  context: PublicAssistantContext;
  initialQuestion: string;
  onInitialQuestionConsumed: () => void;
  onClose: () => void;
}

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function PublicAssistantDialog({
  open,
  context,
  initialQuestion,
  onInitialQuestionConsumed,
  onClose,
}: PublicAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastInitialQuestionRef = useRef('');

  // 锁定背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  // 自动滚到底部
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages, loading]);

  const sendQuestion = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || loading) return;

      setError('');
      setInput('');
      setLoading(true);
      setMessages((prev) => [...prev, { id: newMessageId(), role: 'user', content: question }]);

      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, context }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'AI 服务暂时不可用，请稍后重试。');
        const answer = typeof data?.answer === 'string' ? data.answer : '';
        if (!answer.trim()) throw new Error('AI 未返回有效内容，请重试。');
        setMessages((prev) => [
          ...prev,
          { id: newMessageId(), role: 'assistant', content: answer },
        ]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'AI 服务暂时不可用，请稍后重试。';
        setError(message);
        setMessages((prev) => [
          ...prev,
          { id: newMessageId(), role: 'assistant', content: message },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [context, loading],
  );

  // 处理外部传入的初始问题
  useEffect(() => {
    if (!open) return;
    const question = initialQuestion.trim();
    if (!question || lastInitialQuestionRef.current === question) return;
    lastInitialQuestionRef.current = question;
    onInitialQuestionConsumed();
    void sendQuestion(question);
  }, [initialQuestion, onInitialQuestionConsumed, open, sendQuestion]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasMessages = messages.length > 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#10213d]/45 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="水叮当智能助手"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-[680px] flex-col overflow-hidden rounded-3xl bg-[#f7faff] shadow-[0_28px_80px_rgba(7,24,52,.28)] ring-1 ring-white/60 sm:h-[600px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e1e9f4] bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <PublicAssistantAvatar
              size="sm"
              expression={loading ? 'thinking' : 'normal'}
            />
            <div>
              <div className="text-base font-black text-[#123a6e]">水叮当</div>
              <div className="text-[11px] text-[#8a96aa]">智慧水发 · AI 智能助手</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#8a96aa] transition hover:bg-[#f1f5fb] hover:text-[#123a6e]"
            aria-label="关闭水叮当"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!hasMessages ? (
            <PublicAssistantWelcome context={context} onAsk={sendQuestion} />
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <PublicAssistantMessage key={message.id} message={message} />
              ))}
              {loading && (
                <div className="flex items-center gap-3 text-sm font-semibold text-[#5a6d8a]">
                  <PublicAssistantAvatar size="sm" expression="thinking" animated />
                  <span className="rounded-2xl border border-[#e1e9f4] bg-white px-4 py-3">
                    水叮当思考中…
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {/* Input */}
        <form
          className="flex gap-3 border-t border-[#e1e9f4] bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendQuestion(input);
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion(input);
              }
            }}
            placeholder="输入问题，水叮当为你解答…"
            rows={1}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-[#cdd9ea] bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-[#064ea2] focus:bg-white"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-11 rounded-2xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82] disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
