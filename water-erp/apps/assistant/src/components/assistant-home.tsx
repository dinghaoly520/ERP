'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from './assistant-home.module.css';
import { Send, Loader2, BarChart3, AlertTriangle, Users, ShoppingBag, FileText, Calendar, Search, Bell, Shield, Zap, TrendingUp, ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';

type QuickStats = {
  procurement: { total: number; pending: number };
  bid: { total: number; active: number };
  supplier: { total: number; approved: number; pending: number; risk: number };
  expert: { total: number; available: number };
  announcement: { published: number };
  catalog: { items: number };
  notification: { unread: number };
  focusAreas: string[];
};

type Card = {
  icon: LucideIcon;
  label: string;
  subtitle: string;
  tool: string;
  args: Record<string, unknown>;
};

function buildCards(s: QuickStats | null): Card[] {
  const LOADING: Card[] = Array.from({ length: 8 }, () => ({
    icon: BarChart3, label: '加载中...', subtitle: '', tool: 'global_overview', args: { action: 'stats' },
  }));

  if (!s) return LOADING;

  const { procurement, bid, supplier, catalog, announcement, notification, focusAreas } = s;

  const hasAlerts = focusAreas.length > 0;
  const hasRisk = supplier.risk > 0 || (bid.active > 0);
  const hasPending = supplier.pending > 0 || procurement.pending > 0;

  // Icon selection driven by system state
  const iconDashboard: LucideIcon = !hasAlerts ? BarChart3 : TrendingUp;
  const iconQa: LucideIcon = hasRisk ? AlertTriangle : hasAlerts ? Search : Zap;
  const iconRisk: LucideIcon = hasRisk ? Shield : Search;
  const iconSupplier: LucideIcon = hasPending ? AlertTriangle : Users;
  const iconMall: LucideIcon = catalog.items > 0 ? ShoppingBag : TrendingUp;
  const iconToday: LucideIcon = bid.active > 0 ? Calendar : notification.unread > 0 ? Bell : Calendar;
  const iconReport: LucideIcon = bid.total > 0 ? FileText : announcement.published > 0 ? ClipboardList : FileText;
  const iconOps: LucideIcon = hasPending ? AlertTriangle : ClipboardList;

  return [
    {
      icon: iconDashboard,
      label: procurement.total === 0 ? '启动首个采购项目' : `采购${procurement.total} · 招标${bid.active}/${bid.total}`,
      subtitle: bid.active > 0 ? `${bid.active} 个项目在开/评标中` : procurement.pending > 0 ? `${procurement.pending} 个项目待审批` : '系统运行正常',
      tool: 'global_overview', args: { action: 'stats' },
    },
    {
      icon: iconQa,
      label: hasAlerts ? `优先关注：${focusAreas[0]}` : '全系统运行正常',
      subtitle: focusAreas.slice(0, 2).join(' · ') || '点击查看全局详情',
      tool: focusAreas.length > 0 ? 'bid' : 'global_overview',
      args: focusAreas.length > 0 ? { action: 'active' } : { action: 'stats' },
    },
    {
      icon: iconRisk,
      label: supplier.risk > 0 ? `${supplier.risk} 家供应商有风险` : bid.active > 0 ? `${bid.active} 个项目进行中` : '暂无风险项目',
      subtitle: supplier.risk > 0 ? '含停用/黑名单' : bid.active > 0 ? '点击查看投标进展' : '系统运行平稳',
      tool: 'bid', args: supplier.risk > 0 ? { action: 'risks' } : { action: 'stats' },
    },
    {
      icon: iconSupplier,
      label: supplier.pending > 0 ? `${supplier.pending} 家待审核` : `${supplier.approved} 家已入库`,
      subtitle: supplier.pending > 0 ? `${supplier.approved} 家已入库 · 建议尽快处理` : '供应商状态良好',
      tool: 'supplier', args: supplier.pending > 0 ? { action: 'pending' } : { action: 'stats' },
    },
    {
      icon: iconMall,
      label: catalog.items > 0 ? `${catalog.items} 个目录商品` : '商城目录为空',
      subtitle: catalog.items > 0 ? '查看价格与供货趋势' : '建议补充采购目录',
      tool: 'mall', args: { action: 'stats' },
    },
    {
      icon: iconToday,
      label: bid.active > 0 ? `${bid.active} 个招标进行中` : notification.unread > 0 ? `${notification.unread} 条未读通知` : '暂无紧急事项',
      subtitle: bid.active > 0 ? '开标/评标阶段需关注' : notification.unread > 0 ? '建议及时查看' : '系统运行平稳',
      tool: bid.active > 0 ? 'bid' : 'notification', args: bid.active > 0 ? { action: 'active' } : { action: 'list' },
    },
    {
      icon: iconReport,
      label: bid.total > 0 ? `基于${bid.total}个招标项目生成` : announcement.published > 0 ? `基于${announcement.published}条公告生成` : '生成招采运行汇报',
      subtitle: '智能撰稿辅助',
      tool: 'global_overview', args: { action: 'stats' },
    },
    {
      icon: iconOps,
      label: supplier.pending > 0 ? `${supplier.pending} 家供应商待审核` : procurement.pending > 0 ? `${procurement.pending} 个项目待审批` : '暂无待办事项',
      subtitle: supplier.pending > 0 ? '建议尽快完成准入审核' : procurement.pending > 0 ? '采购立项需审批' : '点击查看全局状态',
      tool: 'supplier', args: supplier.pending > 0 ? { action: 'pending' } : procurement.pending > 0 ? { action: 'pending' } : { action: 'stats' },
    },
  ];
}

const copy = {
  title: '智慧水发 · 蜀水云采',
  placeholder: '输入问题 / 生成分析 / 操作业务，如：汇总本月招采风险并画趋势图',
};

function useMouseSpotlight() {
  const layerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const currentRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    const animate = () => {
      const t = targetRef.current;
      const c = currentRef.current;
      c.x += (t.x - c.x) * 0.08;
      c.y += (t.y - c.y) * 0.08;
      const el = layerRef.current;
      if (el) {
        el.style.setProperty('--spotlight-x', `${c.x * 100}%`);
        el.style.setProperty('--spotlight-y', `${c.y * 100}%`);
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    window.addEventListener('mousemove', handleMove, { passive: true });
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return layerRef;
}

export function AssistantHome({
  onSend,
  isLoading,
}: {
  onSend: (msg: string) => void;
  isLoading?: boolean;
}) {
  const [inputValue, setInputValue] = useState('');
  const [stats, setStats] = useState<QuickStats | null>(null);
  const spotlightRef = useMouseSpotlight();

  useEffect(() => {
    let cancelled = false;
    api.get<QuickStats>('/assistant/quick-stats').then((s) => {
      if (!cancelled) setStats(s);
    }).catch(() => {
      // cards stay at loading state
    });
    return () => { cancelled = true; };
  }, []);

  const cards = useMemo(() => buildCards(stats), [stats]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInputValue('');
  }, [inputValue, isLoading, onSend]);

  return (
    <div className={styles.home}>
      <div ref={spotlightRef} className={styles.spotlightLayer} />
      <section className={styles.hero}>
        {/* 品牌区 */}
        <div className={styles.brandRow}>
          <div className={styles.logoShell}>
            <img src="/logo.jpg" alt="Logo" className={styles.logoImage} />
          </div>
          <h1 className={styles.title}>{copy.title}</h1>
        </div>

        {/* 搜索框 */}
        <div className={styles.commandPanel}>
          <div className={styles.commandBox}>
            <textarea
              className={styles.aiInput}
              placeholder={copy.placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              disabled={isLoading}
            />
            <button
              className={`${styles.sendBtn} ${inputValue.trim() && !isLoading ? styles.active : ''}`}
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
              type="button"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>

        {/* 快捷入口 — 实时状态动态生成 */}
        <div className={styles.quickCards}>
          {cards.map((card, idx) => {
            const IconComponent = card.icon;
            return (
              <button
                key={idx}
                className={styles.quickCard}
                onClick={() => {
                  const argsStr = JSON.stringify(card.args);
                  onSend(`请调用 ${card.tool} 工具，参数 ${argsStr}，获取最新数据后给我一份针对性的分析与建议。`);
                }}
                type="button"
              >
                <span className={styles.quickIcon}>
                  <IconComponent size={24} strokeWidth={1.8} />
                </span>
                <span className={styles.quickText}>
                  <span className={styles.quickTitle}>{card.label}</span>
                  {card.subtitle && (
                    <span className={styles.quickDesc}>{card.subtitle}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
