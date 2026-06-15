'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from './assistant-home.module.css';
import { Send, Loader2, Gauge, Search, ShieldAlert, Users, ShoppingBag, CalendarClock, ScrollText, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import GradientText from './GradientText';

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
  prompt: string;
};

function buildCards(s: QuickStats | null): Card[] {
  const LOADING: Card[] = Array.from({ length: 8 }, () => ({
    icon: Gauge, label: '加载中...', subtitle: '', prompt: '',
  }));

  if (!s) return LOADING;

  const { procurement, bid, supplier, catalog, notification, focusAreas } = s;

  return [
    {
      icon: Gauge,
      label: '董事长驾驶舱',
      subtitle: procurement.total === 0
        ? '尚无采购项目 · 建议启动立项'
        : bid.active > 0
          ? `${bid.active} 个招标进行中· ${procurement.pending} 个待审批`
          : `${procurement.total} 个采购 · ${bid.total} 个招标`,
      prompt: '请帮我全面梳理集团招采业务的整体运行状况。我想了解：采购立项的推进节奏如何，有没有卡在审批环节的项目；招标板块的活跃度和各阶段分布是否均衡；供应商库的规模与质量表现，包括入库审核通过率和近期评价趋势；专家资源的可用率及与当前招标项目的专业匹配度；商城目录的丰富程度与交易活跃度。最后请给出一个综合判断——哪些环节运行健康，哪些需要管理层关注，以及建议的优先行动清单。',
    },
    {
      icon: Search,
      label: '全系统数据问答',
      subtitle: focusAreas.length > 0
        ? `⚠ ${focusAreas.slice(0, 2).join(' · ')}`
        : '系统各模块运行正常',
      prompt: '请帮我做一次集团招采系统各模块的全面体检。从采购管理、招标管理、供应商管理、专家管理、商城管理到通知公告，逐一说明每个模块当前的数据表现、运行状态和潜在异常。如果有任何指标偏离正常范围，请分析可能的原因和影响程度。同时也请告诉我近期系统整体呈现的趋势——是向好还是需要警惕，以及最值得关注的几个动态变化。',
    },
    {
      icon: ShieldAlert,
      label: '招采风险扫描',
      subtitle: supplier.risk > 0
        ? `⚠ ${supplier.risk} 家供应商有风险`
        : bid.active > 0
          ? `${bid.active} 个项目在开/评标中`
          : '暂无风险项目',
      prompt: '请帮我对当前招采业务进行一轮全面的风险排查。第一，招标环节是否有异常报价模式、投标人关联关系、围标串标迹象等合规风险；第二，供应商端是否有信用评级下滑、资质到期、履约异常或黑名单关联等风险信号；第三，评标环节是否存在进度严重滞后、专家回避不到位、评分异常离散等程序风险；第四，时间节点层面，哪些项目面临截标、开标或合同签订等关键节点的逼近。最后请按风险等级给出处置优先级和应对建议。',
    },
    {
      icon: Users,
      label: '供应商画像',
      subtitle: supplier.pending > 0
        ? `${supplier.approved} 家已入库 · ${supplier.pending} 家待审核`
        : `${supplier.approved} 家已入库 · 状态良好`,
      prompt: '请帮我全面梳理集团供应商库的现状画像。我需要了解：供应商总体数量与行业分布格局，各分类下的活跃度和贡献度如何；入库审批的流转效率，是否存在积压或退回率偏高的情况；供应商的资质结构和等级分布，各专业方向的供给是否充足；近期参与投标的活跃供应商有哪些，它们的履约评价和风险评级趋势怎样；与历史同期相比，供应商库的规模和质量是提升还是下降。最后请给出优化供应商管理的切实建议。',
    },
    {
      icon: ShoppingBag,
      label: '商城经营分析',
      subtitle: catalog.items > 0
        ? `${catalog.items} 个目录商品 · 可查看价格趋势`
        : '暂无目录数据',
      prompt: '请帮我全面分析采购商城的经营状况。我想了解：目录商品的品类结构和数量规模，是否有品类空白需要补充；近期的价格波动趋势和异常价格预警情况；哪些品类和商品是采购热点，采购频次和金额分布如何；供应商的上架积极性和产品质量表现；商城整体的交易活跃度和同比增长情况；用户端的使用体验反馈和满意度趋势。最后请指出商城经营中存在的短板和优化方向。',
    },
    {
      icon: CalendarClock,
      label: '今日重点事项',
      subtitle: bid.active > 0
        ? `${bid.active} 个招标项目进行中`
        : notification.unread > 0
          ? `${notification.unread} 条未读通知`
          : '暂无紧急事项',
      prompt: '请帮我梳理今天需要重点关注和处理的全部事项。首先是紧急待办类：临近截标的招标项目、超时未审批的采购立项、积压的供应商入库申请、即将到期的专家资质和供应商资质；其次是日程提醒类：今日安排的开标和评标会议、需要签字的合同与文件、需要回复的澄清答疑；再次是通知动态类：重要的系统公告、风险预警推送、业务变更通知。最后请给出今日事项的处理顺序建议，哪些需要优先处理，哪些可以授权他人。',
    },
    {
      icon: ScrollText,
      label: '汇报材料生成',
      subtitle: bid.total > 0
        ? `基于 ${bid.total} 个招标项目生成汇报`
        : '招采运行情况汇报提纲',
      prompt: bid.total > 0
        ? '请帮我起草一份集团招采业务运行情况汇报材料，用于向上级领导汇报近期工作。材料结构建议包括：第一部分，采购立项总体情况——立项数量、审批通过率、与上期对比的变化趋势；第二部分，招标推进执行情况——各阶段项目分布、开评标完成率、平均周期分析；第三部分，供应商管理成效——入库数量、审核效率、履约评价表现；第四部分，专家资源保障情况——专家库规模、参与评标频次、专业覆盖度；第五部分，风险管控与合规情况——发现的主要风险点及处置措施；第六部分，存在的困难与需要协调解决的问题；第七部分，下阶段工作重点与目标。请用数据和事实支撑每个部分，语言简洁专业。'
        : '请帮我起草一份集团招采业务运行情况汇报提纲，用于向上级领导汇报近期工作。提纲结构建议包括：采购立项总体情况、招标推进执行情况、供应商管理成效、专家资源保障情况、风险管控与合规情况、存在的困难与需要协调的问题、下阶段工作重点与目标。请在每个部分下列出需要准备的关键数据和要点提示。',
    },
    {
      icon: Wrench,
      label: '业务操作助手',
      subtitle: supplier.pending > 0
        ? `${supplier.pending} 家供应商待审核`
        : procurement.pending > 0
          ? `${procurement.pending} 个采购项目待审批`
          : '暂无待办事项',
      prompt: '请帮我系统地梳理当前需要我处理的所有业务操作事项。我想全面了解：采购管理方面有哪些待审批的立项申请，各自的紧急程度和审批注意要点；供应商管理方面有哪些待审核的入库申请，审核的关注重点和常见退回原因；招标管理方面有哪些需要我跟进的项目，包括待发布公告、待确认开标、待录入评标结果等环节；专家管理方面是否需要我协调专家排期或更新专家信息。请给出每类事项的处理建议和可参考的操作规范。',
    },
  ];
}

const copy = {
  title: '智慧水发 · 蜀水云采',
  placeholder: '输入问题 / 生成分析 / 操作业务，如：汇总本月招采风险并画趋势图',
};

function useSpotlightLight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -200, y: -200 });
  const animIdRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    function resize() {
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
    }

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx!.clearRect(0, 0, w * dpr, h * dpr);
      ctx!.save();
      ctx!.scale(dpr, dpr);

      // 鼠标跟随小型暖色光晕
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      if (mx > -100 && my > -100) {
        const g = ctx!.createRadialGradient(mx, my, 0, mx, my, 180);
        g.addColorStop(0, 'rgba(255, 230, 200, 0.12)');
        g.addColorStop(0.5, 'rgba(255, 220, 180, 0.04)');
        g.addColorStop(1, 'transparent');
        ctx!.fillStyle = g;
        ctx!.fillRect(0, 0, w, h);
      }

      ctx!.restore();
      animIdRef.current = requestAnimationFrame(draw);
    }

    const handleMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleLeave = () => {
      mouseRef.current = { x: -200, y: -200 };
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMove, { passive: true });
    document.body.addEventListener('mouseleave', handleLeave);
    animIdRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animIdRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMove);
      document.body.removeEventListener('mouseleave', handleLeave);
    };
  }, []);

  return canvasRef;
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
  const spotlightCanvasRef = useSpotlightLight();

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
      {/* 鼠标跟随小型暖色光晕 */}
      <canvas
        ref={spotlightCanvasRef}
        className={styles.spotlightCanvas}
        aria-hidden="true"
      />

      <section className={styles.hero}>
        {/* 品牌区 */}
        <div className={styles.brandRow}>
          <div className={styles.logoShell}>
            <img src="/logo.jpg" alt="Logo" className={styles.logoImage} />
          </div>
          <h1 className={styles.title}>
            <GradientText
              colors={['#1a2332', '#2563EB', '#0891b2', '#18a56c', '#1a2332']}
              animationSpeed={8}
              direction="horizontal"
              yoyo={true}
            >
              {copy.title}
            </GradientText>
          </h1>
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

        <div className={styles.quickCards}>
            {cards.map((card, idx) => {
              const IconComponent = card.icon;
              return (
                <button
                  key={idx}
                  className={styles.quickCard}
                  onClick={() => {
                    if (card.prompt) onSend(card.prompt);
                  }}
                  type="button"
                >
                  <span className={styles.quickIcon}>
                    <IconComponent size={24} strokeWidth={1.8} />
                  </span>
                  <span className={styles.quickText}>
                    <span className={styles.quickTitle}>{card.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
      </section>
    </div>
  );
}
