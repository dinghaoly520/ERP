import { Lightbulb } from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

export function ProjectBriefCard({
  dailyPlan,
}: {
  dailyPlan: WorkArrangementDailyPlan | null;
}) {
  if (!dailyPlan) return null;
  const text = dailyPlan.projectBrief || '';
  if (!text) {
    return (
      <div className="neu-content-block rounded-[18px]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
          <Lightbulb size={16} aria-hidden="true" />项目简报
        </div>
        <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">暂无项目数据</p>
      </div>
    );
  }

  // 无【】标记 → 纯文本段落
  if (!text.includes('【')) {
    return (
      <div className="neu-content-block rounded-[18px]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
          <Lightbulb size={16} aria-hidden="true" />
          项目简报
        </div>
        <p className="mt-3 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
          {text}
        </p>
      </div>
    );
  }

  // 有【】标记 → 分段渲染
  const sections: { title: string; body: string }[] = [];
  const firstBracket = text.indexOf('【');
  const preamble = firstBracket > 0 ? text.slice(0, firstBracket).trim() : '';

  if (firstBracket >= 0) {
    const parts = text.slice(firstBracket).split('【');
    for (const part of parts) {
      const sepIdx = part.indexOf('】');
      if (sepIdx > 0) {
        const title = part.slice(0, sepIdx).trim();
        const content = part.slice(sepIdx + 1).trim();
        if (title) sections.push({ title, body: content });
      }
    }
  }

  return (
    <div className="neu-content-block rounded-[18px]">
      <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
        <Lightbulb size={16} aria-hidden="true" />
        项目简报
      </div>

      {preamble && (
        <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">
          {preamble}
        </p>
      )}

      {sections.map((section, index) => {
        const body = section.body;
        const items = body.match(/\d+\.「/g);
        const subParagraphs = items && items.length > 1
          ? body.split(/(?=\d+\.「)/).filter(Boolean).map(s => s.trim())
          : [body];

        return (
          <div key={index} className="mt-3">
            <h4 className="text-sm font-semibold text-amber-800">
              【{section.title}】
            </h4>
            {subParagraphs.map((sub, si) => (
              <p key={si} className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                {sub}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
