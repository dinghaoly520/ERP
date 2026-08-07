'use client';

import { PublicAssistantAvatar } from './avatar';
import type { PublicAssistantContext } from './types';

const QUICK_QUESTIONS = [
  '采购公告一般包含哪些内容？',
  '供应商注册需要准备什么材料？',
  '如何解读中标结果公示？',
  '电子采购平台的评标流程是怎样的？',
  '开标过程中有哪些注意事项？',
];

interface PublicAssistantWelcomeProps {
  context: PublicAssistantContext;
  onAsk: (question: string) => void;
}

function buildContextHint(context: PublicAssistantContext) {
  const parts: string[] = [];

  if (context.recentAnnouncements.length > 0) {
    const types = [...new Set(context.recentAnnouncements.map((a) => a.type))];
    const typeLabels: Record<string, string> = {
      BID_NOTICE: '采购公告',
      WIN_NOTICE: '中标公告',
      POLICY: '政策法规',
      PLATFORM: '平台公告',
    };
    parts.push(`最新公告涵盖：${types.map((t) => typeLabels[t] || t).join('、')}`);
  }

  if (context.searchQuery) {
    parts.push(`当前搜索：「${context.searchQuery}」`);
  }

  return parts.length > 0 ? `我会结合${parts.join('，')}来回答。` : null;
}

export function PublicAssistantWelcome({ context, onAsk }: PublicAssistantWelcomeProps) {
  const contextHint = buildContextHint(context);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <PublicAssistantAvatar size="lg" expression="normal" animated />
      <h3 className="mt-5 text-xl font-black text-[#123a6e]">你好，我是水叮当</h3>
      <p className="mt-2 max-w-md text-sm leading-7 text-[#5a6d8a]">
        我是智慧水发·蜀水云采的智能助手，可以解答招投标流程、政策法规、公告解读等问题。
      </p>
      {contextHint && (
        <p className="mt-3 max-w-lg rounded-full bg-[#eef6ff] px-4 py-2 text-xs font-semibold text-[#064ea2]">
          {contextHint}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="rounded-full border border-[#cdd9ea] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:border-[#064ea2] hover:bg-[#f3f8ff] active:scale-95"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
