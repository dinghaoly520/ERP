'use client';

import { motion } from 'framer-motion';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantMessage as Message } from './types';

interface MallAssistantMessageProps {
  message: Message;
  index?: number;
}

export function MallAssistantMessage({ message, index = 0 }: MallAssistantMessageProps) {
  const isUser = message.role === 'user';
  const initials = isUser ? '我' : '水叮当';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, delay: index * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="shrink-0 pt-0.5">
          <MallAssistantAvatar size="sm" expression="serious" animated />
        </div>
      )}

      <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} max-w-[78%]`}>
        {/* 微小标签行 */}
        <span className={`font-mono text-[9px] font-bold tracking-widest ${isUser ? 'text-[#8a96aa]' : 'text-[#5b9bd5]/60'}`}>
          {initials}
        </span>

        {/* 消息气泡 */}
        <div
          className="whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 border border-white/30"
          style={
            isUser
              ? {
                  background: 'linear-gradient(135deg, rgba(91,155,213,.12) 0%, rgba(99,102,241,.08) 100%)',
                  backdropFilter: 'blur(14px) saturate(1.15)',
                  WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
                  borderBottomRightRadius: '6px',
                  color: '#1e3a5f',
                  boxShadow: '0 1px 2px rgba(15,35,65,.02), 0 0 0 1px rgba(255,255,255,.15) inset',
                }
              : {
                  background: 'linear-gradient(135deg, rgba(255,255,255,.24) 0%, rgba(248,251,255,.28) 40%, rgba(242,247,255,.24) 100%)',
                  backdropFilter: 'blur(18px) saturate(1.2)',
                  WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
                  borderBottomLeftRadius: '6px',
                  color: '#24364f',
                  boxShadow: '0 1px 3px rgba(15,35,65,.03), 0 2px 10px rgba(91,155,213,.05), 0 0 0 1px rgba(255,255,255,.20) inset',
                }
          }
        >
          {message.content}
        </div>
      </div>

      {isUser && (
        <div className="shrink-0 pt-0.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black text-[#5b9bd5]/60"
            style={{ background: 'rgba(91,155,213,.08)', border: '1px solid rgba(91,155,213,.15)' }}>
            我
          </span>
        </div>
      )}
    </motion.div>
  );
}
