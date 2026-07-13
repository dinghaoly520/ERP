import { useState, useEffect } from 'react';
import { Sun, Sunset, Moon, CloudSun, ListTodo, PlayCircle, CalendarDays, AlertTriangle, Bell } from 'lucide-react';
import type { WorkArrangementDailyPlan, WorkArrangementWorkbenchOverview } from '@/lib/types/work-arrangements';
import type { AuthUser } from '@/lib/api/auth';
import { useNotifications } from '@/lib/hooks/use-notifications';

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
const TDP: Record<TimeOfDay,{g:string;gl:string;r:string;s:string;t:string;d:string}> = {
  morning:{g:'linear-gradient(135deg,rgba(215,248,250,0.92),rgba(198,244,246,0.82),rgba(182,240,242,0.72))',gl:'rgba(80,210,218,0.22)',r:'rgba(62,190,200,0.38)',s:'rgba(172,242,244,0.48)',t:'#0a4d42',d:'rgba(94,207,214,0.92)'},
  afternoon:{g:'linear-gradient(135deg,rgba(225,250,252,0.92),rgba(208,246,248,0.82),rgba(192,242,244,0.72))',gl:'rgba(72,205,212,0.20)',r:'rgba(56,184,195,0.34)',s:'rgba(162,238,240,0.44)',t:'#0b5045',d:'rgba(85,210,216,0.92)'},
  evening:{g:'linear-gradient(135deg,rgba(200,242,246,0.92),rgba(183,235,240,0.82),rgba(168,230,236,0.72))',gl:'rgba(62,195,205,0.24)',r:'rgba(50,174,185,0.40)',s:'rgba(148,232,236,0.50)',t:'#0c5548',d:'rgba(75,200,208,0.92)'},
  night:{g:'linear-gradient(135deg,rgba(180,235,242,0.92),rgba(163,228,236,0.82),rgba(148,222,230,0.72))',gl:'rgba(52,185,198,0.26)',r:'rgba(42,164,178,0.42)',s:'rgba(135,225,232,0.52)',t:'#0d5a4b',d:'rgba(66,190,200,0.92)'},
};
function gtod(h:number):TimeOfDay{if(h>=6&&h<11)return'morning';if(h>=11&&h<18)return'afternoon';if(h>=18&&h<24)return'evening';return'night';}
const WD=['周日','周一','周二','周三','周四','周五','周六'];

function LiveClock(){
  const[n,setN]=useState<Date|null>(null);
  useEffect(()=>{setN(new Date());const t=setInterval(()=>setN(new Date()),1000);return()=>clearInterval(t);},[]);
  if(!n)return<div className="live-clock-container"/>;
  const h=n.getHours();const p=TDP[gtod(h)];const ts=`${String(h).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;const iw=n.getDay()===0||n.getDay()===6;
  return(<div className="live-clock-container" style={{'--lc-glow':p.gl,'--lc-ring':p.r,'--lc-sweep':p.s,'--lc-text':p.t} as React.CSSProperties}><div className="live-clock-ring"/><div className="live-clock-pill" style={{background:p.g,color:p.t}}><div className="live-clock-sweep"/><span className="live-clock-dot" style={{background:p.d}}/><span className="live-clock-time">{ts}<span className="live-clock-seconds">{String(n.getSeconds()).padStart(2,'0')}</span></span><span className="live-clock-divider" style={{background:`linear-gradient(180deg,transparent,${p.r},transparent)`}}/><span className="live-clock-date">{n.getMonth()+1}月{n.getDate()}日 {WD[n.getDay()]}</span>{iw&&<span className="live-clock-weekend">休息日</span>}</div></div>);
}

const TDC={morning:{icon:Sun},afternoon:{icon:CloudSun},evening:{icon:Sunset},night:{icon:Moon}} as const;
function gtod2(h:number):TimeOfDay{if(h>=6&&h<11)return'morning';if(h>=11&&h<18)return'afternoon';if(h>=18&&h<24)return'evening';return'night';}

function periodLabel(h: number): string {
  if (h >= 6 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  return '晚上好';
}

interface StatBadge {
  key: string;
  label: string;
  value: number;
  icon: typeof ListTodo;
  color: string;
  bg: string;
}

export function WorkbenchOverview({
  currentUser,
  dailyPlan,
  summary,
}: {
  currentUser: AuthUser | null;
  dailyPlan: WorkArrangementDailyPlan | null;
  summary: WorkArrangementWorkbenchOverview;
}) {
  const now = new Date();
  const Icon = TDC[gtod2(now.getHours())].icon;
  const period = periodLabel(now.getHours());
  const userName = currentUser?.username === 'Swhi-CGZX-00'
    ? '张宏董事长'
    : currentUser?.displayName || '用户';
  const rawUsername = currentUser?.username ?? '';
  const loading = !dailyPlan;
  const headerGreeting = dailyPlan?.headerGreeting ?? '';

  const { derivedTodo } = useNotifications();
  const notificationCount =
    derivedTodo.supplierPending + derivedTodo.priceReview + derivedTodo.expiringQualifications;

  const badges: StatBadge[] = [
    { key: 'notif', label: '通知待办', value: notificationCount, icon: Bell, color: '#7c3aed', bg: '#f5f3ff' },
    { key: 'todo', label: '待办', value: summary.todoCount, icon: ListTodo, color: '#6366f1', bg: '#eef2ff' },
    { key: 'progress', label: '进行中', value: summary.inProgressCount, icon: PlayCircle, color: '#0ea5e9', bg: '#f0f9ff' },
    { key: 'today', label: '今日到期', value: summary.dueTodayCount, icon: CalendarDays, color: '#f59e0b', bg: '#fffbeb' },
    { key: 'risk', label: '风险项', value: summary.riskCount, icon: AlertTriangle, color: '#ef4444', bg: '#fef2f2' },
  ];

  return (
    <section className="page-hero">
      {/* ═══ 第一行：图标 + 问候 + 时钟 ═══ */}
      <div className="page-hero__row">
        <div className="page-hero__left">
          <div className="page-hero__icon">
            <Icon size={20} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="page-hero__title">
              <span className="font-normal text-[color:var(--muted-foreground)]">
                {period}
              </span>
              <span className="font-bold">，{userName}</span>
            </div>
          </div>
        </div>
        <div className="page-hero__right">
          <LiveClock />
        </div>
      </div>

      {/* ═══ 第二行：关怀问候文本 ═══ */}
      <div className="page-hero__row mt-3">
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--accent)]" />
              <span className="text-[14px] leading-relaxed text-[color:var(--muted-foreground)]">
                正在为您准备今日工作简报...
              </span>
            </div>
          ) : (
            <p className="max-w-[640px] text-[14px] leading-relaxed text-pretty text-[color:var(--foreground)]">
              {headerGreeting
                .replace('{name}', '')
                .replace(userName, '')
                .replace(rawUsername, '')
                .replace(/^[，,]\s*/, '') ||
                `${period}，${userName}。今天先处理重点事项，再推进进行中工作。`}
            </p>
          )}
        </div>
      </div>

      {/* ═══ 第三行：统计徽章 ═══ */}
      <div className="page-hero__row mt-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {badges.map((b) => (
            <div
              key={b.key}
              className="flex items-center gap-2 rounded-xl px-3.5 py-2"
              style={{ backgroundColor: b.bg }}
            >
              <b.icon size={14} style={{ color: b.color }} />
              <span className="text-[13px] font-bold tabular-nums" style={{ color: b.color }}>
                {b.value}
              </span>
              <span className="text-[11px] font-semibold text-[#5a6d8a]">{b.label}</span>
            </div>
          ))}
          {badges.every((b) => b.value === 0) && (
            <span className="text-[12px] text-[color:var(--muted-foreground)]">
              今日暂无待办和通知，可以规划新任务或复盘已完成工作
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
