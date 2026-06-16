'use client';

import { PublicAssistantAvatar } from './avatar';
import type { PublicAssistantMessage as Message } from './types';

interface PublicAssistantMessageProps {
  message: Message;
}

export function PublicAssistantMessage({ message }: PublicAssistantMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <PublicAssistantAvatar size="sm" expression="normal" />}
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${
          isUser
            ? 'rounded-br-md bg-[#064ea2] text-white'
            : 'rounded-bl-md border border-[#e1e9f4] bg-white text-[#24364f]'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
