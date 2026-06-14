import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantContext } from './types';

const QUICK_QUESTIONS = ['分析当前筛选结果', '找出需复核价格', '生成预算清单建议'];

interface MallAssistantWelcomeProps {
  context: MallAssistantContext;
  onAsk: (question: string) => void;
}

const isActiveFilter = (value: string) => value.trim() && value !== '全部';

function buildContextHint(context: MallAssistantContext) {
  const filters = [
    isActiveFilter(context.currentFilters.category) ? context.currentFilters.category : null,
    isActiveFilter(context.currentFilters.region) ? context.currentFilters.region : null,
    isActiveFilter(context.currentFilters.status) ? context.currentFilters.status : null,
    isActiveFilter(context.currentFilters.source) ? context.currentFilters.source : null,
    context.currentFilters.search.trim() ? `关键词「${context.currentFilters.search.trim()}」` : null,
  ].filter(Boolean);

  const parts: string[] = [];
  if (filters.length > 0) parts.push(`当前筛选：${filters.join(' / ')}`);
  if (context.budget.length > 0) parts.push(`预算清单 ${context.budget.length} 项`);
  if (context.selectedItem) parts.push(`当前商品：${context.selectedItem.name}`);

  return parts.length > 0 ? `我会结合${parts.join('，')}来回答。` : null;
}

export function MallAssistantWelcome({ context, onAsk }: MallAssistantWelcomeProps) {
  const contextHint = buildContextHint(context);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <MallAssistantAvatar size="lg" expression="normal" />
      <h3 className="mt-5 text-xl font-black text-[#123a6e]">你好，我是水叮当</h3>
      <p className="mt-2 max-w-md text-sm leading-7 text-[#5a6d8a]">我可以帮你研判目录价格、生成预算建议、比较供应商报价。</p>
      {contextHint && (
        <p className="mt-3 max-w-lg rounded-full bg-[#eef6ff] px-4 py-2 text-xs font-semibold text-[#064ea2]">{contextHint}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_QUESTIONS.map(question => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="rounded-full border border-[#cdd9ea] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:border-[#064ea2] hover:bg-[#f3f8ff]"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
