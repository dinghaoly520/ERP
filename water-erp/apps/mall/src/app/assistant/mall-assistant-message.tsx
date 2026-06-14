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
