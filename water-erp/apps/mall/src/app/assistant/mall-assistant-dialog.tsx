'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import { MallAssistantMessage } from './mall-assistant-message';
import { MallAssistantWelcome } from './mall-assistant-welcome';
import type { MallAssistantContext, MallAssistantMessage as Message } from './types';

interface MallAssistantDialogProps {
  open: boolean;
  context: MallAssistantContext;
  initialQuestion: string;
  onInitialQuestionConsumed: () => void;
  onClose: () => void;
}

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function MallAssistantDialog({
  open,
  context,
  initialQuestion,
  onInitialQuestionConsumed,
  onClose,
}: MallAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastInitialQuestionRef = useRef('');

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

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

  useEffect(() => {
    if (!open) return;
    const question = initialQuestion.trim();
    if (!question || lastInitialQuestionRef.current === question) return;
    lastInitialQuestionRef.current = question;
    onInitialQuestionConsumed();
    void sendQuestion(question);
  }, [initialQuestion, onInitialQuestionConsumed, open, sendQuestion]);

  if (!open) return null;

  const hasMessages = messages.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        style={{ background: 'rgba(15,35,65,.35)' }}
        role="dialog"
        aria-modal="true"
        aria-label="水叮当"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="relative flex max-h-[calc(100vh-48px)] w-full max-w-[760px] flex-col overflow-hidden rounded-3xl sm:h-[680px]"
          initial={{ opacity: 0, y: 32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          style={{
            background: 'linear-gradient(160deg, rgba(255,255,255,.28) 0%, rgba(248,251,255,.32) 30%, rgba(242,247,255,.28) 60%, rgba(248,251,255,.32) 100%)',
            backdropFilter: 'blur(36px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(36px) saturate(1.2)',
            boxShadow: '0 1px 2px rgba(15,35,65,.04), 0 8px 40px rgba(7,24,52,.10), 0 0 0 1px rgba(255,255,255,.50) inset, 0 0 0 1px rgba(91,155,213,.08)',
          }}
        >
          {/* 顶边渐变线 - 数据流 */}
          <div className="absolute top-0 left-0 right-0 h-[2px] z-20 pointer-events-none overflow-hidden rounded-t-3xl">
            <motion.div
              className="absolute inset-0"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(91,155,213,.4) 10%, rgba(99,102,241,.5) 30%, rgba(59,130,246,.4) 50%, rgba(91,155,213,.3) 70%, transparent 100%)',
              }}
            />
          </div>

          {/* 背景粒子 */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full"
                style={{
                  width: 1.5 + (i % 3),
                  height: 1.5 + (i % 3),
                  background: i < 4 ? 'rgba(91,155,213,.22)' : 'rgba(99,102,241,.18)',
                  left: `${8 + (i * 11)}%`,
                  top: `${60 + (i * 7) % 30}%`,
                }}
                animate={{ y: [0, -24 - i * 6, 0], opacity: [0.15, 0.55, 0.15] }}
                transition={{ duration: 4 + i * 1.4, repeat: Infinity, delay: i * 0.8, ease: 'easeInOut' }}
              />
            ))}
          </div>

          {/* Header — HUD 风格 */}
          <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/20" style={{ background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
            <div className="flex items-center gap-3.5">
              <MallAssistantAvatar
                size="sm"
                expression={loading ? 'thinking' : 'normal'}
                animated
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-black tracking-wide text-[#1e3a5f]" style={{ fontFamily: 'monospace' }}>水叮当</span>
                  <span className="font-mono text-[10px] font-bold tracking-widest text-[#5b9bd5]/60 uppercase">v2.4 · online</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.5)]" />
                  <span className="text-[10px] font-bold text-[#8a96aa] tracking-wide">READY · 已接入蜀水云采实时数据</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-[#f1f5fb] hover:text-[#2c5282]"
              aria-label="关闭水叮当"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
            {!hasMessages ? (
              <MallAssistantWelcome context={context} onAsk={sendQuestion} />
            ) : (
              <div className="space-y-4">
                <AnimatePresence>
                  {messages.map((message, idx) => (
                    <MallAssistantMessage key={message.id} message={message} index={idx} />
                  ))}
                </AnimatePresence>
                {loading && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-3"
                  >
                    <MallAssistantAvatar size="sm" expression="thinking" animated />
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-[#bfd4f4]/40 px-4 py-3" style={{ background: 'rgba(240,245,254,.75)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
                      {/* 思考波纹 */}
                      {[0, 1, 2, 3].map(i => (
                        <motion.span
                          key={i}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-[#5b9bd5]/60"
                          animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                        />
                      ))}
                      <span className="ml-1.5 text-xs font-bold text-[#5a6d8a]">分析中</span>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="relative z-10 border-t border-red-100 bg-red-50/80 backdrop-blur-sm px-5 py-2 text-xs font-semibold text-red-700"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input — 科技感玻璃输入区 */}
          <form
            className="relative z-10 flex gap-3 p-4 border-t border-[#dce5f0]/40"
            style={{ background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
            onSubmit={(event) => {
              event.preventDefault();
              void sendQuestion(input);
            }}
          >
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion(input);
                  }
                }}
                placeholder="输入您的问题，水叮当为您分析…"
                rows={1}
                className="w-full max-h-28 min-h-11 resize-none rounded-2xl border border-[#cdd9ea]/60 px-4 py-3 pr-10 text-sm placeholder:text-[#bcc6d4] outline-none transition"
                style={{
                  background: 'rgba(248,251,255,.75)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  boxShadow: '0 0 0 1px rgba(255,255,255,.30) inset, 0 1px 3px rgba(15,35,65,.03)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,.92)';
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(91,155,213,.15) inset, 0 0 0 3px rgba(91,155,213,.06), 0 1px 3px rgba(15,35,65,.04)';
                  e.currentTarget.style.borderColor = 'rgba(91,155,213,.35)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.background = 'rgba(248,251,255,.75)';
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,.30) inset, 0 1px 3px rgba(15,35,65,.03)';
                  e.currentTarget.style.borderColor = 'rgba(205,217,234,.60)';
                }}
              />
              {/* 输入框内 AI 小光点 */}
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#5b9bd5]/40" />
              </span>
            </div>
            <motion.button
              type="submit"
              disabled={loading || !input.trim()}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="h-11 rounded-2xl px-5 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-40 shadow-[0_2px_8px_rgba(91,155,213,.25)]"
              style={{
                background: 'linear-gradient(135deg, #5b9bd5 0%, #3b82f6 50%, #6366f1 100%)',
              }}
            >
              发送
            </motion.button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
