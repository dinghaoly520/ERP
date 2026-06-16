'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
};

function buildCards(s: QuickStats | null): Card[] {
  const LOADING: Card[] = Array.from({ length: 8 }, () => ({
    icon: Gauge, label: '加载中...', subtitle: '',
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
    },
    {
      icon: Search,
      label: '全系统数据问答',
      subtitle: focusAreas.length > 0
        ? `⚠ ${focusAreas.slice(0, 2).join(' · ')}`
        : '系统各模块运行正常',
    },
    {
      icon: ShieldAlert,
      label: '招采风险扫描',
      subtitle: supplier.risk > 0
        ? `⚠ ${supplier.risk} 家供应商有风险`
        : bid.active > 0
          ? `${bid.active} 个项目在开/评标中`
          : '暂无风险项目',
    },
    {
      icon: Users,
      label: '供应商画像',
      subtitle: supplier.pending > 0
        ? `${supplier.approved} 家已入库 · ${supplier.pending} 家待审核`
        : `${supplier.approved} 家已入库 · 状态良好`,
    },
    {
      icon: ShoppingBag,
      label: '商城经营分析',
      subtitle: catalog.items > 0
        ? `${catalog.items} 个目录商品 · 可查看价格趋势`
        : '暂无目录数据',
    },
    {
      icon: CalendarClock,
      label: '今日重点事项',
      subtitle: bid.active > 0
        ? `${bid.active} 个招标项目进行中`
        : notification.unread > 0
          ? `${notification.unread} 条未读通知`
          : '暂无紧急事项',
    },
    {
      icon: ScrollText,
      label: '汇报材料生成',
      subtitle: bid.total > 0
        ? `基于 ${bid.total} 个招标项目生成汇报`
        : '招采运行情况汇报提纲',
    },
    {
      icon: Wrench,
      label: '业务操作助手',
      subtitle: supplier.pending > 0
        ? `${supplier.pending} 家供应商待审核`
        : procurement.pending > 0
          ? `${procurement.pending} 个采购项目待审批`
          : '暂无待办事项',
    },
  ];
}

// ===================================================================
// 提示词变异系统 — 每次点击生成不同措辞，核心主旨不变
// ===================================================================
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleSlice<T>(arr: T[], min: number, max: number): T[] {
  const n = Math.floor(Math.random() * (max - min + 1)) + min;
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

type PromptKit = {
  openings: string[];
  aspects: string[];
  closings: string[];
};

const promptKits: PromptKit[] = [
  // 0: 董事长驾驶舱
  {
    openings: [
      '请帮我全面梳理集团招采业务的整体运行状况。',
      '帮我做一次集团招采业务全景扫描，我需要一份综合判断。',
      '请从管理层视角，对我集团当前的招采运行态势做一个整体评估。',
      '请帮我鸟瞰一下集团招采体系的全貌，看看整体健康度如何。',
    ],
    aspects: [
      '采购立项的推进节奏如何，有没有卡在审批环节的项目',
      '招标板块的活跃度和各阶段分布是否均衡，有没有进度异常的项目',
      '供应商库的规模与质量表现，入库审核通过率和近期评价趋势',
      '专家资源的可用率及与当前招标项目的专业匹配度',
      '商城目录的丰富程度与交易活跃度',
      '近期是否有异常指标波动或值得关注的变化信号',
      '与上月/上季度相比，哪些指标在改善，哪些在恶化',
    ],
    closings: [
      '最后请给出一个综合判断——哪些环节运行健康，哪些需要管理层关注，以及建议的优先行动清单。',
      '请最后帮我做一个总结：当前最突出的三个亮点和三个风险点，以及建议的应对措施。',
      '最后请用"绿灯/黄灯/红灯"三色标注各模块的健康状态，并给出下一步管理建议。',
    ],
  },
  // 1: 全系统数据问答
  {
    openings: [
      '请帮我做一次集团招采系统各模块的全面体检。',
      '帮我逐模块扫描一下招采系统的运行状态，看看哪里有问题。',
      '我想对集团招采系统做一轮深度巡检，请逐一分析各模块。',
      '请系统性地审查采购、招标、供应商、专家、商城、公告六大模块的当前状态。',
    ],
    aspects: [
      '采购管理模块的数据表现和运行状态',
      '招标管理各阶段的项目分布和流程效率',
      '供应商库的规模、活跃度和审核流转情况',
      '专家资源的可用性和参与评标的频次分布',
      '商城目录的品类覆盖和交易活跃度',
      '通知公告的发布频率和覆盖范围',
      '各模块之间的数据联动是否正常，有没有信息断层',
      '近期系统整体的变化趋势——是向好还是需要警惕',
    ],
    closings: [
      '如果有任何指标偏离正常范围，请分析可能的原因和影响程度，并给出最值得关注的几个动态变化。',
      '请指出当前系统最薄弱的一环是什么，以及改善它的具体路径。',
      '最后请给出一个系统健康度评分（1-10分），并说明扣分项和提分建议。',
    ],
  },
  // 2: 招采风险扫描
  {
    openings: [
      '请帮我对当前招采业务进行一轮全面的风险排查。',
      '帮我做一次招采风控扫描，我要了解当前的主要风险敞口。',
      '请从合规、信用、进度、安全四个维度，对招采业务做风险评估。',
      '我需要对当前的招采风险画像有一个清晰认识，请全面梳理。',
    ],
    aspects: [
      '招标环节是否有异常报价模式、投标人关联关系或围标串标迹象',
      '供应商端是否有信用评级下滑、资质到期、履约异常或黑名单关联的风险',
      '评标环节是否存在进度严重滞后、专家回避不到位、评分异常离散等程序风险',
      '哪些项目面临截标、开标或合同签订等关键节点的逼近',
      '预算执行是否存在超支风险或资金使用异常',
      '是否有供应商集中度过高、单一来源占比过大等供应链风险',
      '近期监管政策变化是否对在途项目产生合规影响',
    ],
    closings: [
      '请按高/中/低三档标注每项风险等级，给出处置优先级和具体应对建议。',
      '最后请帮我排一个风险处理顺序——哪些需要立即响应，哪些可以持续监控。',
      '请给出一个风险热力图概要，并针对排名前三的风险制定详细的缓解方案。',
    ],
  },
  // 3: 供应商画像
  {
    openings: [
      '请帮我全面梳理集团供应商库的现状画像。',
      '帮我深入分析一下供应商库的整体情况，我想看到结构和趋势。',
      '请从多个维度描绘集团供应商资源的全景图。',
      '我想了解一下供应商队伍的规模、质量、活跃度和潜在问题。',
    ],
    aspects: [
      '供应商总体数量与行业分类的分布格局',
      '各分类下的活跃度和贡献度如何，有没有"僵尸"供应商',
      '入库审批的流转效率和通过率，是否存在积压或退回率偏高的情况',
      '供应商的资质结构和等级分布，各专业方向的供给是否充足',
      '近期参与投标的活跃供应商及其履约评价和风险评级趋势',
      '与历史同期相比，供应商库的规模和质量是提升还是下降',
      '供应商的地域分布是否合理，偏远地区的供给保障如何',
      '是否存在对个别供应商的过度依赖，供应链韧性如何',
    ],
    closings: [
      '最后请给出优化供应商管理的切实建议，包括结构优化、风险管控和效率提升。',
      '请总结供应商库的三大优势和三大短板，并提出针对性的改善措施。',
      '请基于数据给出供应商管理的优先级建议——哪些问题需要优先解决，哪些可以徐徐图之。',
    ],
  },
  // 4: 商城经营分析
  {
    openings: [
      '请帮我全面分析采购商城的经营状况。',
      '帮我深入了解一下商城当前的运营数据和存在问题。',
      '请从商品、交易、用户三个维度对商城经营做一次全面诊断。',
      '我想了解采购商城运行的整体表现和优化空间。',
    ],
    aspects: [
      '目录商品的品类结构和数量规模，是否有品类空白需要补充',
      '近期的价格波动趋势和异常价格预警情况',
      '哪些品类和商品是采购热点，采购频次和金额分布如何',
      '供应商的上架积极性和产品质量表现',
      '商城整体的交易活跃度和同比增长情况',
      '用户端的使用体验反馈和满意度趋势',
      '订单履约效率和退换货率等服务质量指标',
      '与外部电商平台相比，商城的价格竞争力和服务差异化如何',
    ],
    closings: [
      '最后请指出商城经营中存在的短板和优化方向，给出切实可行的改进建议。',
      '请帮我把问题按"紧急且重要"矩阵排列，并给出下阶段的重点运营策略。',
      '最后请给出一个商城健康度评分，说明主要扣分项和具体的提升路径。',
    ],
  },
  // 5: 今日重点事项
  {
    openings: [
      '请帮我梳理今天需要重点关注和处理的全部事项。',
      '帮我理一下今天的工作重点，哪些事情需要优先处理。',
      '请给我一份今日工作清单，按紧急程度排列。',
      '今天有哪些事情需要我关注？请帮我系统地整理一下。',
    ],
    aspects: [
      '临近截标的招标项目和即将开标的时间节点',
      '超时未审批的采购立项和积压的审核任务',
      '积压的供应商入库申请和即将到期的资质证件',
      '今日安排的评标会议和需要我参加的活动',
      '需要签字确认的合同文件和需要回复的澄清答疑',
      '重要的系统公告、风险预警推送和业务变更通知',
      '专家排期中是否存在冲突或缺口需要协调',
      '昨天遗留下来今天需要跟进的事项',
    ],
    closings: [
      '最后请给出今日事项的处理顺序建议——哪些需要我亲自处理，哪些可以授权他人。',
      '请帮我估算每件事的大致耗时，并给出一个合理的日程安排建议。',
      '最后请标注每件事的紧急程度和重要程度，帮我做一个四象限分类。',
    ],
  },
  // 6: 汇报材料生成
  {
    openings: [
      '请帮我起草一份集团招采业务运行情况汇报材料，用于向上级领导汇报近期工作。',
      '我需要准备一份招采业务的工作汇报，请帮我整理内容框架和关键数据要点。',
      '请协助我撰写一份面向管理层的招采体系运行报告。',
      '帮我生成一份招采业务综合分析报告，要突出数据和趋势。',
    ],
    aspects: [
      '采购立项总体情况——立项数量、审批通过率、与上期对比的变化趋势',
      '招标推进执行情况——各阶段项目分布、开评标完成率、平均周期分析',
      '供应商管理成效——入库数量、审核效率、履约评价表现',
      '专家资源保障情况——专家库规模、参与评标频次、专业覆盖度',
      '风险管控与合规情况——发现的主要风险点及处置措施',
      '存在的困难与需要协调解决的问题',
      '下阶段工作重点与目标',
    ],
    closings: [
      '请用数据和事实支撑每个部分，语言简洁专业，篇幅控制在2000字以内。',
      '请用"成效-问题-计划"三段式结构组织报告，每个部分都要有数据论据。',
      '请突出亮点和进步，同时不回避问题，做到客观全面、重点突出。',
    ],
  },
  // 7: 业务操作助手
  {
    openings: [
      '请帮我系统地梳理当前需要我处理的所有业务操作事项。',
      '帮我理一理手头有哪些待办的业务操作，我想逐项过一遍。',
      '请给我一份当前业务待办清单，并告诉我每个事项的处理要点。',
      '我想全面了解一下各模块中需要我介入处理的事项。',
    ],
    aspects: [
      '采购管理方面有哪些待审批的立项申请，各自的紧急程度和审批注意要点',
      '供应商管理方面有哪些待审核的入库申请，审核的关注重点和常见退回原因',
      '招标管理方面有哪些需要我跟进的项目，包括待发布公告、待确认开标、待录入评标结果',
      '专家管理方面是否需要协调专家排期或更新专家信息',
      '合同管理方面有哪些待签署或即将到期的合同',
      '是否有需要我处理的异常告警或风险预警',
      '有没有跨部门协调事项或需要上级决策的问题',
    ],
    closings: [
      '请给出每类事项的处理建议和可参考的操作规范，帮我提高处理效率。',
      '请按"今天必须完成/本周内完成/可以稍后处理"三档分类，并给出每件事的操作指引。',
      '请先处理最紧急的3件事，给出详细的操作步骤和注意事项，其余事项列清单即可。',
    ],
  },
];

function generatePrompt(cardIndex: number, s: QuickStats | null): string {
  const kit = promptKits[cardIndex];
  if (!kit) return '';

  const opening = pick(kit.openings);
  const aspects = shuffleSlice(kit.aspects, 4, 6);
  const closing = pick(kit.closings);

  // Build natural text with numbered aspects
  const aspectText = aspects.map((a, i) => {
    const prefixes = [
      `我想了解：`,
      `请帮我看看：`,
      `然后，`,
      `另外，`,
      `同时，`,
      `还有，`,
      `再者，`,
      `此外，`,
    ];
    // First aspect gets a full intro, others use transition words
    if (i === 0) return `我想了解：${a}`;
    return `${pick(prefixes.slice(2))}${a}`;
  }).join('');

  return `${opening}${aspectText}。${closing}`;
}

const copy = {
  title: '智慧水发 · 蜀水云采',
  placeholder: '输入问题 / 生成分析 / 操作业务，如：汇总本月招采风险并画趋势图',
};

export function AssistantHome({
  onSend,
  isLoading,
}: {
  onSend: (msg: string) => void;
  isLoading?: boolean;
}) {
  const [inputValue, setInputValue] = useState('');
  const [stats, setStats] = useState<QuickStats | null>(null);
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
                    const prompt = generatePrompt(idx, stats);
                    if (prompt) onSend(prompt);
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
