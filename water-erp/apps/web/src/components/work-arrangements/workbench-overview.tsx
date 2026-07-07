import { useState, useEffect } from 'react';
import { Sun, Sunset, Moon, CloudSun } from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { AuthUser } from '@/lib/api/auth';

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

export function WorkbenchOverview({currentUser,dailyPlan}:{currentUser:AuthUser|null;dailyPlan:WorkArrangementDailyPlan|null}){
  const now=new Date();
  const Icon=TDC[gtod2(now.getHours())].icon;
  const userName=currentUser?.username==='Swhi-CGZX-00'?'尊敬的张宏董事长':currentUser?.displayName||'用户';
  const rawUsername = currentUser?.username ?? '';
  const loading=!dailyPlan;
  const headerGreeting=dailyPlan?.headerGreeting??'';
  const dailyGreeting=dailyPlan?.dailyGreeting??'';
  return(
    <section className="wb-panel">
      <div className="px-6 py-5 flex items-start justify-between gap-6">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <Icon size={24} style={{color:'var(--accent)'}} className="shrink-0 mt-1"/>
          <div className="min-w-0">
            {(()=>{
              const greet=loading?'':((headerGreeting||'').replace('{name}','').replace(userName,'').replace(rawUsername,'').replace(/^[，,]\s*/,'')||'你好呀');
              return(
                <div className="text-[17px] text-[#18243a] leading-relaxed">
                  <span className="font-bold">{userName}</span>
                  <span className="text-[color:var(--muted-foreground)] font-normal">
                    {loading?'，欢迎您':`，${greet}`}
                  </span>
                </div>
              );
            })()}
            {!loading&&dailyGreeting?(
              <div className="mt-2 text-[13px] text-[color:var(--muted-foreground)] leading-relaxed">
                {dailyGreeting.replace('{name}','').replace(userName,'').replace(rawUsername,'').replace(/^[，,]\s*/,'')}
              </div>
            ):null}
          </div>
        </div>
        <LiveClock/>
      </div>
    </section>
  );
}
