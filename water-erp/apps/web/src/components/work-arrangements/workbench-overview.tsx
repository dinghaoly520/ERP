import { useState, useEffect, useMemo } from 'react';
import { Sun, Sunset, Moon, CloudSun } from 'lucide-react';
import type { WorkArrangementWorkbenchOverview, WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { AuthUser } from '@/lib/api/auth';

// ─── Live Clock Component ────────────────────────────────────────────────────

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

const TIME_OF_DAY_PALETTE: Record<TimeOfDay, {
  gradient: string;
  glow: string;
  ring: string;
  sweep: string;
  text: string;
  dot: string;
}> = {
  morning: {
    gradient: 'linear-gradient(135deg, rgba(255,248,225,0.92) 0%, rgba(255,243,200,0.82) 40%, rgba(255,236,170,0.72) 100%)',
    glow: 'rgba(245,158,11,0.18)',
    ring: 'rgba(245,158,11,0.32)',
    sweep: 'rgba(255,220,120,0.38)',
    text: '#92400e',
    dot: 'rgba(245,158,11,0.92)',
  },
  afternoon: {
    gradient: 'linear-gradient(135deg, rgba(225,239,255,0.92) 0%, rgba(210,230,255,0.82) 40%, rgba(195,220,255,0.72) 100%)',
    glow: 'rgba(59,130,246,0.16)',
    ring: 'rgba(59,130,246,0.3)',
    sweep: 'rgba(140,185,255,0.36)',
    text: '#1e3a5f',
    dot: 'rgba(59,130,246,0.92)',
  },
  evening: {
    gradient: 'linear-gradient(135deg, rgba(255,230,220,0.92) 0%, rgba(250,210,195,0.82) 40%, rgba(245,190,175,0.72) 100%)',
    glow: 'rgba(239,68,68,0.14)',
    ring: 'rgba(236,72,153,0.28)',
    sweep: 'rgba(250,170,150,0.36)',
    text: '#7c2d12',
    dot: 'rgba(236,72,153,0.88)',
  },
  night: {
    gradient: 'linear-gradient(135deg, rgba(230,230,250,0.92) 0%, rgba(215,215,248,0.82) 40%, rgba(200,200,245,0.72) 100%)',
    glow: 'rgba(139,92,246,0.16)',
    ring: 'rgba(139,92,246,0.3)',
    sweep: 'rgba(180,160,255,0.36)',
    text: '#312e81',
    dot: 'rgba(139,92,246,0.88)',
  },
};

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
  return 'night';
}

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// Derive a full clock palette from any hex accent color so the clock
// harmonises with the greeting card's dynamic background.
function paletteFromColor(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const mix = (factor: number) => ({
    r: Math.round(r + (255 - r) * factor),
    g: Math.round(g + (255 - g) * factor),
    b: Math.round(b + (255 - b) * factor),
  });

  const light = mix(0.92);
  const mid   = mix(0.87);
  const deep  = mix(0.80);

  return {
    gradient: `linear-gradient(135deg, rgba(${light.r},${light.g},${light.b},0.94) 0%, rgba(${mid.r},${mid.g},${mid.b},0.84) 40%, rgba(${deep.r},${deep.g},${deep.b},0.74) 100%)`,
    glow: `rgba(${r},${g},${b},0.16)`,
    ring: `rgba(${r},${g},${b},0.30)`,
    sweep: `rgba(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)},0.36)`,
    text: `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`,
    dot: `rgba(${r},${g},${b},0.88)`,
    weekendBg: `rgba(${r},${g},${b},0.12)`,
    weekendText: `rgb(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.45)})`,
  };
}

function LiveClock({ accentColor }: { accentColor?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <div className="live-clock-container" />;

  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const palette = accentColor
    ? paletteFromColor(accentColor)
    : { ...TIME_OF_DAY_PALETTE[getTimeOfDay(hour)], weekendBg: 'rgba(236,72,153,0.12)', weekendText: '#be185d' };

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const secondStr = String(second).padStart(2, '0');
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekDay = WEEK_DAYS[now.getDay()];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  return (
    <div className="live-clock-container" style={{ '--lc-glow': palette.glow, '--lc-ring': palette.ring, '--lc-sweep': palette.sweep, '--lc-text': palette.text, '--lc-weekend-bg': palette.weekendBg, '--lc-weekend-text': palette.weekendText } as React.CSSProperties}>
      {/* Breathing ring */}
      <div className="live-clock-ring" />

      {/* Main pill */}
      <div
        className="live-clock-pill"
        style={{ background: palette.gradient, color: palette.text }}
      >
        {/* Flowing light sweep */}
        <div className="live-clock-sweep" />

        {/* Dot indicator */}
        <span className="live-clock-dot" style={{ background: palette.dot }} />

        {/* Time digits */}
        <span className="live-clock-time">
          {timeStr}
          <span className="live-clock-seconds">{secondStr}</span>
        </span>

        {/* Divider */}
        <span className="live-clock-divider" style={{ background: `linear-gradient(180deg, transparent, ${palette.ring}, transparent)` }} />

        {/* Date */}
        <span className="live-clock-date">
          {month}月{day}日 {weekDay}
        </span>

        {/* Weekend badge */}
        {isWeekend && (
          <span className="live-clock-weekend">
            休息日
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Overview Component ─────────────────────────────────────────────────

// 颜色关键词映射
const COLOR_KEYWORDS: Record<string, string> = {
  // 红色系
  '红': '#EF4444',
  '朱': '#DC2626',
  '赤': '#EF4444',
  '霞': '#F97316',
  '枫': '#EF4444',
  '火': '#F97316',
  '日': '#F59E0B',
  '阳': '#F59E0B',
  '橙': '#F97316',
  // 金黄色系
  '金': '#F59E0B',
  '黄': '#FBBF24',
  '菊': '#F59E0B',
  '秋': '#F59E0B',
  // 绿色系
  '绿': '#10B981',
  '翠': '#10B981',
  '柳': '#22C55E',
  '竹': '#10B981',
  '松': '#059669',
  '春': '#22C55E',
  // 蓝色系
  '蓝': '#3B82F6',
  '碧': '#0EA5E9',
  '青': '#06B6D4',
  '天': '#38BDF8',
  '海': '#0284C7',
  // 紫色系
  '紫': '#A855F7',
  '薰': '#A855F7',
  '薇': '#C084FC',
  // 白色系
  '白': '#6B7280',
  '雪': '#9CA3AF',
  '云': '#64748B',
  '月': '#A78BFA',
  '银': '#94A3B8',
  // 黑色系
  '黑': '#374151',
  '墨': '#1F2937',
  '夜': '#4B5563',
};

// 根据主色生成配套的渐变背景
function generateGradient(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  const lightR = Math.min(255, r + 245);
  const lightG = Math.min(255, g + 245);
  const lightB = Math.min(255, b + 245);

  const midR = Math.min(255, r + 230);
  const midG = Math.min(255, g + 230);
  const midB = Math.min(255, b + 230);

  return `linear-gradient(135deg, rgba(${lightR},${lightG},${lightB}) 0%, rgba(${midR},${midG},${midB}) 50%, #FFFFFF 100%)`;
}

// 根据主色生成边框颜色
function generateBorderColor(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

// 根据主色生成背景色
function generateAccentBg(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.1)`;
}

// 暖色调颜色列表（用于随机选择）
const WARM_COLORS = [
  '#F59E0B',
  '#EF4444',
  '#F97316',
  '#EC4899',
  '#A855F7',
  '#3B82F6',
  '#10B981',
  '#6366F1',
  '#14B8A6',
  '#8B5CF6',
];

// 根据诗句内容获取颜色（使用日期种子确保同一天颜色一致）
function getGreetingColor(greeting: string, dateSeed: number): string {
  if (!greeting) {
    return 'rgb(100, 116, 139)';
  }

  for (const [keyword, color] of Object.entries(COLOR_KEYWORDS)) {
    if (greeting.includes(keyword)) {
      return color;
    }
  }

  // 使用日期种子确保同一天颜色一致，而不是随机
  const seededIndex = dateSeed % WARM_COLORS.length;
  return WARM_COLORS[seededIndex];
}

// 时段配置
const TIME_OF_DAY_CONFIG = {
  morning: { icon: Sun },
  afternoon: { icon: CloudSun },
  evening: { icon: Sunset },
  night: { icon: Moon },
} as const;

// 根据小时获取时段
function getTimeOfDayForIcon(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
  return 'night';
}

// 格式化日期显示
function formatDateDisplay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = weekDays[date.getDay()];
  return `${month}月${day}日 ${weekDay}`;
}

// 判断是否周末
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function WorkbenchOverview({
  currentUser,
  summary,
  dailyPlan,
}: {
  currentUser: AuthUser | null;
  summary: WorkArrangementWorkbenchOverview;
  dailyPlan: WorkArrangementDailyPlan | null;
}) {
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = getTimeOfDayForIcon(hour);
  const timeConfig = TIME_OF_DAY_CONFIG[timeOfDay];
  const IconComponent = timeConfig.icon;

  const userName = currentUser?.username === 'Swhi-CGZX-00'
    ? '尊敬的张宏董事长'
    : currentUser?.displayName || '用户';

  const loading = !dailyPlan;
  const headerGreeting = dailyPlan?.headerGreeting ?? '';
  const namePraise = dailyPlan?.namePraise ?? '';
  const dailyGreeting = dailyPlan?.dailyGreeting ?? '';
  const aiSuggestion = dailyPlan?.aiSuggestion ?? '';

  // 根据诗句内容获取主色（使用日期种子确保同一天颜色一致，并用 useMemo 缓存）
  const greetingColor = useMemo(() => {
    const dateSeed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    return getGreetingColor(dailyGreeting || headerGreeting, dateSeed);
  }, [dailyGreeting, headerGreeting, now]);

  // 根据主色生成配套样式
  const gradient = generateGradient(greetingColor);
  const borderColor = generateBorderColor(greetingColor);
  const accentBg = generateAccentBg(greetingColor);

  return (
    <section
      className="rounded-[24px] px-6 py-5 shadow-sm"
      style={{
        background: gradient,
        border: `1px solid ${borderColor}`,
      }}
    >
      {/* 标题行：问候 + 实时时钟 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <IconComponent size={20} style={{ color: greetingColor }} aria-hidden="true" />
          <div className="text-base font-medium tracking-[-0.01em] text-[color:var(--foreground)]">
            {loading
              ? `${userName}，欢迎您`
              : headerGreeting
                ? headerGreeting.replace('{name}', userName)
                : `${userName}，你好呀`}
          </div>
        </div>

        {/* Dynamic live clock — palette adapts to greeting card color */}
        <LiveClock accentColor={greetingColor} />
      </div>

      {/* 名字赏析（低频彩蛋，AI 生成） */}
      {!loading && namePraise ? (
        <div
          className="mt-2.5 text-sm leading-relaxed italic"
          style={{
            background: 'linear-gradient(135deg, #B8860B, #DAA520, #E8A87C)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {namePraise.replace('{name}', userName)}
        </div>
      ) : null}

      {/* 第一行：每日问候（AI生成，诗句/关怀/时事，不涉及工作） */}
      {loading ? (
        <div className="mt-3 text-sm text-[color:var(--muted-foreground)]">
          新的一天，愿你心情愉悦，工作顺利。
        </div>
      ) : dailyGreeting ? (
        <div
          className="mt-3 text-sm leading-relaxed"
          style={{ color: greetingColor }}
        >
          {dailyGreeting}
        </div>
      ) : null}

      {/* AI 建议卡片（AI生成） */}
      {!loading && aiSuggestion ? (
        <div
          className="mt-4 rounded-[14px] px-4 py-3"
          style={{
            background: accentBg,
            borderLeft: `3px solid ${greetingColor}`,
          }}
        >
          <div
            className="text-sm leading-relaxed"
            style={{ color: greetingColor }}
          >
            {aiSuggestion}
          </div>
        </div>
      ) : null}
    </section>
  );
}
