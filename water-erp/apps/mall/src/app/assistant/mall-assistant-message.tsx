import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantMessage as Message } from './types';

interface MallAssistantMessageProps {
  message: Message;
}

export function MallAssistantMessage({ message }: MallAssistantMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <MallAssistantAvatar size="sm" expression="serious" />}
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${
          isUser
            ? 'rounded-br-md bg-[#5b9bd5]/16 border border-[#5b9bd5]/25 backdrop-blur-sm text-[#1e3a5f]'
            : 'rounded-bl-md border border-[#bfd4f4]/40 bg-[#f0f5fe]/80 backdrop-blur-sm text-[#24364f]'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
