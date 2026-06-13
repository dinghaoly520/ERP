'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { formatDateTime, numberOrZero, statusTone } from '@/lib/workbench';
import {
  AlertTriangle, ArrowRight, BellRing, Building2, CheckCircle2,
  Clock3, FileText, Megaphone, PlusCircle, ShieldAlert, Sparkles,
  TrendingUp, UsersRound,
} from 'lucide-react';

interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
}

interface AnnouncementStats {
  total: number;
  published: number;
  bidNotice: number;
  winNotice: number;
  policy: number;
}

interface ExpertAssignment {
  id: string;
  progress: number;
  signedIn: boolean;
  project?: { stage?: string };
}

interface ExpertItem {
  id: string;
  displayName: string;
  bidExperts?: ExpertAssignment[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [supplierStats, setSupplierStats] = useState<SupplierStats | null>(null);
  const [announcementStats, setAnnouncementStats] = useState<AnnouncementStats | null>(null);
  const [experts, setExperts] = useState<ExpertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);

    Promise.all([
      api.get<SupplierStats>('/supplier/stats').catch(() => null),
      api.get<AnnouncementStats>('/announcements/stats').catch(() => null),
      api.get<ExpertItem[]>('/expert-admin').catch(() => []),
    ]).then(([ss, as, expertList]) => {
      setSupplierStats(ss);
      setAnnouncementStats(as);
      setExperts(Array.isArray(expertList) ? expertList : []);
      setLoading(false);
    });
  }, []);

  const expertActiveCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => item.project?.stage !== 'ARCHIVED').length;
  }, 0), [experts]);

  const expertUnfinishedCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => numberOrZero(item.progress) < 100).length;
  }, 0), [experts]);

  const pendingSuppliers = numberOrZero(supplierStats?.pending);
  const announcementDraftLike = Math.max(numberOrZero(announcementStats?.total) - numberOrZero(announcementStats?.published), 0);
  const supplierRisk = numberOrZero(supplierStats?.disabled) + numberOrZero(supplierStats?.blacklist);
  const totalTodos = pendingSuppliers + announcementDraftLike + expertUnfinishedCount;
  const alertCount = supplierRisk + (expertUnfinishedCount > 0 ? 1 : 0);

  const metricCards = [
    { label: '今日待办', value: totalTodos, hint: '三大中心待处理事项', icon: BellRing, tone: statusTone.blue },
    { label: '待发布/待审核信息', value: announcementDraftLike, hint: '草稿、待发布、未发布信息', icon: Megaphone, tone: statusTone.orange },
    { label: '待审供应商', value: pendingSuppliers, hint: '注册入库审核', icon: Building2, tone: statusTone.green },
    { label: '专家待处理事项', value: expertUnfinishedCount, hint: '履职、分配、评价事项', icon: UsersRound, tone: statusTone.purple },
    { label: '风险预警', value: alertCount, hint: '异常供应商与专家提醒', icon: ShieldAlert, tone: statusTone.red },
  ];

  const todoItems = [
    { type: '信息发布', title: `${announcementDraftLike} 条信息需要完善或发布`, desc: '检查草稿、待发布和发布状态', path: '/notice', tone: statusTone.orange },
    { type: '供应商审核', title: `${pendingSuppliers} 家供应商等待审核`, desc: '处理注册资料、资质文件和入库状态', path: '/supplier', tone: statusTone.green },
    { type: '专家管理', title: `${expertUnfinishedCount} 项专家事项待跟进`, desc: '关注专家分配、回避和履职评价', path: '/expert', tone: statusTone.purple },
  ];

  const centerCards = [
    { title: '信息发布中心', desc: '公告、公示、政策制度、草稿与发布记录', path: '/notice', icon: Megaphone, tone: statusTone.blue, action: '进入发布中心' },
    { title: '供应商管理中心', desc: '供应商审核、供应商库、评价、变更和黑名单', path: '/supplier', icon: Building2, tone: statusTone.green, action: '处理供应商' },
    { title: '专家管理中心', desc: '专家库、抽取分配、回避关系、履职评价', path: '/expert', icon: UsersRound, tone: statusTone.purple, action: '管理专家' },
  ];

  return (
    <div className="min-h-full space-y-6 bg-[radial-gradient(circle_at_top_left,rgba(14,98,208,0.10),transparent_34%),linear-gradient(180deg,#f7fbff_0%,#f8fafc_100%)]">
      <section className="overflow-hidden rounded-2xl border border-[#dbeafe] bg-white/85 p-6 shadow-[0_18px_60px_rgba(15,47,87,0.08)] backdrop-blur">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#064ea2] text-white shadow-[0_12px_30px_rgba(6,78,162,0.28)]">
              <Sparkles size={26} strokeWidth={1.6} />
            </div>
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">
                <TrendingUp size={13} strokeWidth={1.6} /> 采购管理工作台
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0f2f57]">欢迎回来，{user?.displayName || '管理员'}</h1>
              <p className="mt-1 text-sm text-[#5a6d8a]">聚焦信息发布、供应商管理、专家管理，统一处理待办与风险。</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/notice')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#053f85]">
              <PlusCircle size={16} /> 新建信息
            </button>
            <button onClick={() => router.push('/supplier')} className="inline-flex items-center gap-2 rounded-xl border border-[#dbeafe] bg-white px-4 py-2 text-sm font-semibold text-[#064ea2] hover:bg-[#eff6ff]">
              处理待办 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-5 gap-4">
        {metricCards.map(card => (
          <button key={card.label} onClick={() => router.push(card.label.includes('信息') ? '/notice' : card.label.includes('供应商') ? '/supplier' : card.label.includes('专家') ? '/expert' : '/dashboard')} className="group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: card.tone.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#5a6d8a]">{card.label}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: card.tone.color, backgroundColor: card.tone.bg }}><card.icon size={18} strokeWidth={1.6} /></span>
            </div>
            <div className="text-3xl font-black tracking-tight text-[#18243a]">{loading ? '—' : card.value}</div>
            <p className="mt-1 text-xs text-[#8a96aa]">{card.hint}</p>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-[1.45fr_0.95fr] gap-6">
        <div className="rounded-2xl border border-[#e5ecf4] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#18243a]">待办工作台</h2>
              <p className="text-sm text-[#5a6d8a]">按业务中心聚合需要立即处理的事项</p>
            </div>
            <Clock3 className="text-[#8a96aa]" size={20} />
          </div>
          <div className="space-y-3">
            {todoItems.map(item => (
              <button key={item.type} onClick={() => router.push(item.path)} className="w-full rounded-xl border p-4 text-left transition hover:bg-[#f8fbff]" style={{ borderColor: item.tone.border }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: item.tone.color, backgroundColor: item.tone.bg }}>{item.type}</span>
                    <h3 className="mt-3 font-semibold text-[#18243a]">{item.title}</h3>
                    <p className="mt-1 text-sm text-[#5a6d8a]">{item.desc}</p>
                  </div>
                  <ArrowRight className="text-[#8a96aa]" size={18} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#fee2e2] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#18243a]">风险与预警</h2>
              <p className="text-sm text-[#5a6d8a]">异常供应商、发布异常和专家履职提醒</p>
            </div>
            <AlertTriangle className="text-[#e74c3c]" size={20} />
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4">
              <div className="font-semibold text-[#9a3412]">异常/黑名单供应商</div>
              <p className="mt-1 text-sm text-[#9a3412]/75">当前 {supplierRisk} 家供应商处于停用或黑名单状态。</p>
            </div>
            <div className="rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] p-4">
              <div className="font-semibold text-[#5b21b6]">专家履职提醒</div>
              <p className="mt-1 text-sm text-[#5b21b6]/75">{expertUnfinishedCount} 项专家事项未完成，请及时跟进。</p>
            </div>
            <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4">
              <div className="font-semibold text-[#064ea2]">数据更新时间</div>
              <p className="mt-1 text-sm text-[#064ea2]/75">{formatDateTime(new Date())}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-4">
        {centerCards.map(card => (
          <button key={card.title} onClick={() => router.push(card.path)} className="rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: card.tone.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ color: card.tone.color, backgroundColor: card.tone.bg }}><card.icon size={22} strokeWidth={1.6} /></span>
              <ArrowRight className="text-[#8a96aa]" size={18} />
            </div>
            <h3 className="text-lg font-bold text-[#18243a]">{card.title}</h3>
            <p className="mt-2 min-h-[40px] text-sm leading-5 text-[#5a6d8a]">{card.desc}</p>
            <div className="mt-4 text-sm font-semibold" style={{ color: card.tone.color }}>{card.action}</div>
          </button>
        ))}
      </section>

      <section className="rounded-2xl border border-[#e5ecf4] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#18243a]">最近动态</h2>
          <CheckCircle2 className="text-[#11a874]" size={20} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">发布动态</span><p className="mt-1 text-[#5a6d8a]">已发布 {numberOrZero(announcementStats?.published)} 条信息</p></div>
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">供应商动态</span><p className="mt-1 text-[#5a6d8a]">已入库 {numberOrZero(supplierStats?.approved)} 家供应商</p></div>
          <div className="rounded-xl bg-[#f8fafc] p-4"><span className="font-semibold text-[#18243a]">专家动态</span><p className="mt-1 text-[#5a6d8a]">当前 {expertActiveCount} 项专家参与记录</p></div>
        </div>
      </section>
    </div>
  );
}
