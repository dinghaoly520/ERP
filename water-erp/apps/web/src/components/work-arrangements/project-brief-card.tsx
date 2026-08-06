import { Building2, TrendingUp, CalendarClock, ShieldCheck } from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

function SectionIcon({ title }: { title: string }) {
  // 根据小节标题分配语义化图标
  const lower = title.toLowerCase();
  if (/整体|总体|概览|概况|全局/.test(title)) return <Building2 size={14} />;
  if (/进度|推进|执行|实施|施工/.test(title)) return <TrendingUp size={14} />;
  if (/风险|预警|异常|问题|隐患/.test(title)) return <ShieldCheck size={14} />;
  if (/计划|安排|排期|节点|里程碑/.test(title)) return <CalendarClock size={14} />;
  return null;
}

export function ProjectBriefCard({
  dailyPlan,
}: {
  dailyPlan: WorkArrangementDailyPlan | null;
}) {
  if (!dailyPlan) return null;
  const text = dailyPlan.projectBrief || '';
  if (!text) {
    return (
      <section className="wb-panel">
        <div className="wb-panel-header">
          <span className="text-[15px] font-bold text-[#18243a]">项目简报</span>
        </div>
        <div className="flex items-center justify-center py-16 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无项目数据
        </div>
      </section>
    );
  }

  // 解析【】分段
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

  // 无【】标记 → 纯文本段落
  if (sections.length === 0) {
    return (
      <section className="wb-panel">
        <div className="wb-panel-header">
          <span className="text-[15px] font-bold text-[#18243a]">项目简报</span>
        </div>
        <div className="wb-panel-body" style={{ paddingTop: 0, marginTop: -6 }}>
          <p className="text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
            {text}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="wb-panel">
      {/* ── 头部：AI 标识 + 标题 ── */}
      <div className="wb-panel-header flex items-center justify-between">
        <span className="text-[15px] font-bold text-[#18243a]">项目简报</span>
        <span className="text-[10px] tabular-nums font-medium text-[color:var(--muted-foreground)]">
          {sections.length} 个板块
        </span>
      </div>

      <div className="wb-panel-body space-y-5" style={{ paddingTop: 0, marginTop: -6 }}>
        {/* 序言 */}
        {preamble && (
          <div className="rounded-[14px] bg-[var(--accent-soft)]/6 px-4 py-3">
            <p className="text-sm leading-7 text-pretty text-[color:var(--foreground)]">
              {preamble}
            </p>
          </div>
        )}

        {/* 解析后的节段 — 每节带标题 + 图标 + 正文 */}
        <div className="space-y-4">
          {sections.map((section, idx) => {
            const body = section.body;
            // 拆分数条目段落（「...」格式）
            const items = body.match(/\d+\.「/g);
            const subParagraphs =
              items && items.length > 1
                ? body.split(/(?=\d+\.「)/).filter(Boolean).map((s) => s.trim())
                : [body];

            const icon = SectionIcon(section);

            return (
              <div key={idx} className="rounded-[16px] border border-[color-mix(in_oklch,var(--accent)_12%,transparent)] bg-[var(--accent-soft)]/4 px-5 py-4">
                {/* 小节标题 */}
                <h4 className="flex items-center gap-2 text-[13px] font-bold text-amber-800">
                  {icon && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[rgba(180,83,9,0.1)] text-amber-700">
                      {icon}
                    </span>
                  )}
                  【{section.title}】
                </h4>

                {/* 正文段落 */}
                <div className="mt-2.5 space-y-2">
                  {subParagraphs.map((sub, si) => (
                    <p
                      key={si}
                      className="text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]"
                    >
                      {sub}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
