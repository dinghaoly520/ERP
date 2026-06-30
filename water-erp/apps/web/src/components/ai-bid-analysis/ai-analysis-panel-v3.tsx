'use client';

import { useState, useMemo } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Shield,
  TrendingUp,
  Users,
  Target,
  AlertCircle,
} from 'lucide-react';
import type { AiBidAnalysisTask, AiBidder, StrengthOrWeakness } from '@/lib/types/ai-bid-analysis';
import { ScoreBarChart, DimensionRadarChart, ScoreBreakdownBars } from './ai-bid-analysis-charts';

function neutralizeRecommendationText(text?: string | null) {
  if (!text) return text;

  return text
    .replace(/建议推荐为第?一?中标候选人[，。]?/g, '当前结果仅作为评分分析参考，候选排序需以人工评审结果为准。')
    .replace(/建议推荐为中标候选人[，。]?/g, '当前结果仅作为评分分析参考，是否进入候选排序需以人工评审结果为准。')
    .replace(/推荐为第?一?中标候选人[，。]?/g, '候选排序需以人工评审结果为准。')
    .replace(/推荐为中标候选人[，。]?/g, '是否进入候选排序需以人工评审结果为准。')
    .replace(/第一中标候选人/g, '当前综合评分排序第 1')
    .replace(/中标候选人/g, '候选排序对象')
    .replace(/履约能力强/g, '履约能力相关材料需结合投标文件复核')
    .replace(/履约风险低/g, '当前未识别到结构化高风险因素');
}

interface AiAnalysisPanelV3Props {
  task: AiBidAnalysisTask;
}

export default function AiAnalysisPanelV3({ task }: AiAnalysisPanelV3Props) {
  const [detailTab, setDetailTab] = useState<'score' | 'sw'>('score');
  const [chartType, setChartType] = useState<'radar' | 'bar'>('radar');

  const bidders = task.bidders || [];
  const completedBidders = bidders.filter(b => b.status === 'COMPLETED');

  // 自动选中第一名
  const sortedBidders = useMemo(() =>
    [...completedBidders].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0)),
    [completedBidders]
  );

  const [selectedBidderId, setSelectedBidderId] = useState<string | null>(() =>
    sortedBidders.length > 0 ? sortedBidders[0].id : null
  );

  if (completedBidders.length === 0) {
    return (
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-center py-12 opacity-50">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>暂无分析结果</p>
          <p className="text-sm mt-1">请先上传投标文件并等待分析完成</p>
        </div>
      </div>
    );
  }

  // 统计数据
  const stats = {
    total: completedBidders.length,
    maxScore: Math.max(...completedBidders.map(b => Number(b.totalScore || 0))),
    avgScore: completedBidders.reduce((sum, b) => sum + Number(b.totalScore || 0), 0) / completedBidders.length,
    highRisk: completedBidders.filter(b => b.riskLevel === 'HIGH').length,
  };

  // 图表数据
  const barChartData = sortedBidders.map(b => ({
    name: b.name,
    technical: b.scores?.technical?.totalScore || 0,
    commercial: b.scores?.commercial?.totalScore || 0,
    price: b.scores?.price?.totalScore || 0,
    total: Number(b.totalScore || 0),
  }));

  const radarData = sortedBidders.slice(0, 5).map(b => ({
    name: b.name,
    scores: {
      technical: b.scores?.technical?.totalScore || 0,
      commercial: b.scores?.commercial?.totalScore || 0,
      price: b.scores?.price?.totalScore || 0,
    },
  }));

  const selectedBidder = sortedBidders.find(b => b.id === selectedBidderId);
  const selectedRank = selectedBidder ? sortedBidders.indexOf(selectedBidder) + 1 : 0;

  // 排名徽章
  const rankIcon = (index: number) => {
    if (index === 0) return { bg: '', text: 'text-amber-700', icon: '🥇', style: { background: 'linear-gradient(to bottom right, #fef9c3, #fef3c7)' } };
    if (index === 1) return { bg: '', text: 'text-slate-600', icon: '🥈', style: { background: 'linear-gradient(to bottom right, #f3f4f6, #f1f5f9)' } };
    if (index === 2) return { bg: '', text: 'text-orange-700', icon: '🥉', style: { background: 'linear-gradient(to bottom right, #ffedd5, #fffbeb)' } };
    return { bg: 'bg-gray-50', text: 'text-gray-500', icon: String(index + 1), style: undefined };
  };

  return (
    <div className="space-y-6">
      {/* KPI 卡片区 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="参评单位"
          value={stats.total.toString()}
          icon={<Users className="w-4 h-4" />}
          accent="rgba(96,139,239,1)"
        />
        <KpiCard
          label="最高得分"
          value={stats.maxScore.toFixed(1)}
          icon={<TrendingUp className="w-4 h-4" />}
          accent="rgba(92,181,150,1)"
        />
        <KpiCard
          label="平均得分"
          value={stats.avgScore.toFixed(1)}
          icon={<Target className="w-4 h-4" />}
          accent="rgba(119,129,219,1)"
        />
        <KpiCard
          label="风险预警"
          value={stats.highRisk.toString()}
          sub={stats.highRisk > 0 ? '家高风险' : '无风险'}
          icon={<AlertCircle className="w-4 h-4" />}
          accent={stats.highRisk > 0 ? 'rgba(230,129,102,1)' : 'rgba(92,181,150,1)'}
        />
      </div>

      {/* 主内容区：左侧列表+图表，右侧详情整列 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.6fr)]">
        {/* 左侧：排名卡片列表 + 图表区 */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex-[2] rounded-xl border border-[rgba(200,215,235,0.35)] bg-[linear-gradient(165deg,rgba(255,255,255,0.98),rgba(248,252,255,0.94))] p-3 shadow-[0_4px_20px_rgba(79,108,161,0.08)]">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">排名列表</h3>
            <div className="space-y-2 overflow-y-auto pr-1">
              {sortedBidders.map((bidder, i) => {
                const rank = rankIcon(i);
                const isSelected = bidder.id === selectedBidderId;
                return (
                  <button
                    key={bidder.id}
                    onClick={() => setSelectedBidderId(bidder.id)}
                    data-active={isSelected}
                    className="relative w-full overflow-hidden rounded-[14px] border px-3.5 py-3 text-left transition-all duration-200
                               hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(79,108,161,0.12)]
                               data-[active=true]:border-[rgba(96,139,239,0.5)]
                               data-[active=true]:bg-[linear-gradient(135deg,rgba(238,245,255,0.95),rgba(228,238,255,0.9))]
                               data-[active=true]:shadow-[0_4px_16px_rgba(96,139,239,0.15)]
                               border-[rgba(200,215,235,0.35)]
                               bg-[linear-gradient(165deg,rgba(255,255,255,0.98),rgba(248,252,255,0.94))]"
                  >
                    <span
                      className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-transparent transition-all duration-200 data-[active=true]:bg-[rgba(96,139,239,1)] data-[active=true]:shadow-[0_0_12px_rgba(96,139,239,0.45)]"
                      data-active={isSelected}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${rank.bg} ${rank.text}`} style={rank.style}>
                          {rank.icon}
                        </span>
                        <span className="truncate font-semibold text-base text-[color:var(--foreground)]">{bidder.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base font-bold leading-none" style={{ color: 'var(--accent)' }}>
                          {bidder.totalScore != null ? Number(bidder.totalScore).toFixed(1) : '-'}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          bidder.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700' :
                          bidder.riskLevel === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {bidder.riskLevel === 'HIGH' ? '高' : bidder.riskLevel === 'MEDIUM' ? '中' : '低'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-[color:var(--muted-foreground)]">
                      <span>技 {bidder.scores?.technical?.totalScore?.toFixed(1) || '-'}</span>
                      <span>商 {bidder.scores?.commercial?.totalScore?.toFixed(1) || '-'}</span>
                      <span>价 {bidder.scores?.price?.totalScore?.toFixed(1) || '-'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-[1.08] rounded-[20px] border border-[rgba(200,215,235,0.35)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,248,255,0.92))] p-4 shadow-[0_6px_22px_rgba(79,108,161,0.08)]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">维度对比分析</h4>
              </div>
              <div className="inline-flex rounded-[14px] border border-[rgba(190,208,236,0.55)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,247,255,0.94))] p-1 shadow-[0_4px_14px_rgba(79,108,161,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
                <button
                  data-active={chartType === 'radar'}
                  className="relative min-w-[72px] rounded-[10px] px-3 py-1.5 text-sm font-semibold transition-all
                             data-[active=true]:bg-[linear-gradient(135deg,rgba(96,139,239,0.16),rgba(96,139,239,0.08))]
                             data-[active=true]:text-[rgba(96,139,239,1)]
                             data-[active=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(96,139,239,0.14)]
                             text-[color:var(--muted-foreground)]"
                  onClick={() => setChartType('radar')}
                >
                  雷达图
                </button>
                <button
                  data-active={chartType === 'bar'}
                  className="relative min-w-[72px] rounded-[10px] px-3 py-1.5 text-sm font-semibold transition-all
                             data-[active=true]:bg-[linear-gradient(135deg,rgba(96,139,239,0.16),rgba(96,139,239,0.08))]
                             data-[active=true]:text-[rgba(96,139,239,1)]
                             data-[active=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(96,139,239,0.14)]
                             text-[color:var(--muted-foreground)]"
                  onClick={() => setChartType('bar')}
                >
                  柱状图
                </button>
              </div>
            </div>
            <div className="rounded-[16px] border border-[rgba(214,225,242,0.65)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,250,255,0.96))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
              <div className="flex justify-center overflow-hidden">
                {chartType === 'radar'
                  ? <DimensionRadarChart bidders={radarData} />
                  : <ScoreBarChart data={barChartData} />
                }
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：详情面板整列到底，内部滚动 */}
        <div className="min-h-0 lg:h-full">
          {selectedBidder ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[rgba(200,215,235,0.35)] bg-[linear-gradient(165deg,rgba(255,255,255,0.98),rgba(248,252,255,0.94))] shadow-[0_4px_20px_rgba(79,108,161,0.08)]">
              <div className="shrink-0 border-b border-[rgba(200,215,235,0.25)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.95))]">
                {/* 头部 */}
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-[color:var(--foreground)]">{selectedBidder.name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-[color:var(--muted-foreground)]">
                        <span>第 {selectedRank} 名</span>
                        <span>总分 {selectedBidder.totalScore != null ? Number(selectedBidder.totalScore).toFixed(1) : '-'}</span>
                        <span className={selectedBidder.riskLevel === 'HIGH' ? 'text-red-600' : selectedBidder.riskLevel === 'MEDIUM' ? 'text-yellow-600' : 'text-green-600'}>
                          {selectedBidder.riskLevel === 'HIGH' ? '高风险' : selectedBidder.riskLevel === 'MEDIUM' ? '中风险' : '低风险'}
                        </span>
                      </div>
                    </div>
                    {(() => { const r = rankIcon(selectedRank - 1); return (
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${r.bg} ${r.text}`} style={r.style}>
                      {r.icon}
                    </span>); })()}
                  </div>
                </div>

                {/* Tab 切换 */}
                <div className="mx-5 mb-4 flex gap-1 rounded-lg bg-[var(--muted)] p-2">
                  <button
                    data-active={detailTab === 'score'}
                    onClick={() => setDetailTab('score')}
                    className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all
                               data-[active=true]:bg-white data-[active=true]:shadow-sm
                               data-[active=true]:text-[color:var(--foreground)]
                               text-[color:var(--muted-foreground)]"
                  >
                    评分详情
                  </button>
                  <button
                    data-active={detailTab === 'sw'}
                    onClick={() => setDetailTab('sw')}
                    className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all
                               data-[active=true]:bg-white data-[active=true]:shadow-sm
                               data-[active=true]:text-[color:var(--foreground)]
                               text-[color:var(--muted-foreground)]"
                  >
                    优需关注项分析
                  </button>
                </div>
              </div>

              {/* Tab 内容 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-3">
                {detailTab === 'score' ? (
                  <ScoreDetailContent bidder={selectedBidder} />
                ) : (
                  <StrengthsWeaknessesContent bidder={selectedBidder} />
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[rgba(200,215,235,0.35)] p-8 text-center opacity-50">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>请选择投标单位查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card Component ─────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="relative rounded-[14px] border border-[rgba(200,215,235,0.35)]
                    bg-[linear-gradient(165deg,rgba(255,255,255,0.98),rgba(248,252,255,0.94))]
                    px-4 py-3 shadow-[0_4px_14px_rgba(79,108,161,0.05),inset_0_1px_0_rgba(255,255,255,0.98)]
                    transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(79,108,161,0.1)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
          {label}
        </span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className="flex items-end gap-2 mt-1">
        <span className="text-2xl font-bold tracking-[-0.03em] leading-none" style={{ color: accent }}>
          {value}
        </span>
        {sub && (
          <span className="mb-0.5 text-[10px] font-medium text-[color:var(--muted-foreground)]">{sub}</span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] rounded-b-[14px] opacity-60" style={{ background: `linear-gradient(90deg, ${accent}50, ${accent}15, transparent)` }} />
    </div>
  );
}

// ─── Qualification Detail ──────────────────────────────────────

type ExtractedLicense = {
  type?: string;
  number?: string;
  validFrom?: string;
  validTo?: string;
  issuedBy?: string;
};

type ExtractedQualification = {
  name?: string;
  grade?: string;
  number?: string;
  validTo?: string;
  issuedBy?: string;
  scope?: string;
};

function QualificationDetail({ bidder }: { bidder: AiBidder }) {
  const license = (bidder.extractedInfo as any)?.license as ExtractedLicense | undefined;
  const qualifications = (bidder.extractedInfo as any)?.qualifications as ExtractedQualification[] | undefined;

  return (
    <div className="space-y-2.5">
      {/* 资格状态 */}
      <div className="flex items-center gap-2">
        {bidder.qualificationStatus && bidder.qualificationStatus !== 'unknown' ? (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            bidder.qualificationStatus === '通过'
              ? 'bg-green-100 text-green-700'
              : bidder.qualificationStatus === '待审查'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {bidder.qualificationStatus}
          </span>
        ) : (
          <span className="text-xs text-[color:var(--muted-foreground)]">待审查</span>
        )}
      </div>

      {/* 缺失项 */}
      {bidder.keyInfo?.missingItems && bidder.keyInfo.missingItems.length > 0 && (
        <div className="text-xs text-amber-600">
          缺失项: {bidder.keyInfo.missingItems.join('、')}
        </div>
      )}

      {/* 营业执照/法人证书 */}
      {license && (license.number || license.validTo || license.issuedBy) && (
        <div className="rounded-xl border border-[rgba(200,215,235,0.35)] bg-white/70 p-2.5 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {license.type || '营业执照'}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {license.number && (
              <div><span className="text-slate-400">编号</span> <span className="text-slate-700">{license.number}</span></div>
            )}
            {license.issuedBy && (
              <div><span className="text-slate-400">发证机关</span> <span className="text-slate-700">{license.issuedBy}</span></div>
            )}
            {license.validTo && (
              <div><span className="text-slate-400">有效期至</span> <span className="text-slate-700">{license.validTo}</span></div>
            )}
          </div>
        </div>
      )}

      {/* 资质证书列表 */}
      {qualifications && qualifications.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">资质证书</div>
          {qualifications.map((q, i) => (
            <div key={i} className="rounded-xl border border-[rgba(200,215,235,0.35)] bg-white/70 p-2.5 space-y-1">
              <div className="text-xs font-medium text-slate-800">
                {q.name || '未命名资质'}{q.grade ? ` · ${q.grade}` : ''}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                {q.number && <div><span className="text-slate-400">编号</span> {q.number}</div>}
                {q.validTo && <div><span className="text-slate-400">有效期</span> {q.validTo}</div>}
                {q.issuedBy && <div><span className="text-slate-400">发证机关</span> {q.issuedBy}</div>}
                {q.scope && <div className="col-span-2"><span className="text-slate-400">范围</span> {q.scope}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 无资质明细时显示提示 */}
      {(!qualifications || qualifications.length === 0) && (!license || (!license.number && !license.validTo && !license.issuedBy)) && (
        <div className="text-xs text-slate-400">暂无结构化资质明细，以提取状态为准。</div>
      )}
    </div>
  );
}

// ─── Risk Detail ──────────────────────────────────────────────

function RiskDetail({ bidder }: { bidder: AiBidder }) {
  const ra = bidder.riskAnalysis;
  const ki = bidder.keyInfo;
  const extracted = bidder.extractedInfo as any;

  // Resolve overall risk level with fallback chain
  const level: string =
    ra?.overallRiskLevel ??
    (ra?.overallRisk === 'elevated' ? 'MEDIUM' : ra?.overallRisk === 'normal' ? 'LOW' : undefined) ??
    (bidder.riskLevel === 'HIGH' ? 'HIGH' : bidder.riskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW');

  // Resolve risk factors with fallback
  const factors = ra?.riskFactors?.length
    ? ra.riskFactors
    : ra?.risks?.map((r: any) => ({
        category: r.category || (r.type === 'price' ? '报价' : r.type === 'qualification' ? '资格' : r.type === 'technical' ? '技术' : '商务'),
        description: r.description,
        severity: r.severity,
      })) ?? [];

  const isLow = level === 'LOW';
  const levelLabel = level === 'HIGH' ? '高风险' : level === 'MEDIUM' ? '中风险' : '低风险';

  // Build contextual notes from actual data (not from stored risk descriptions)
  // This ensures both old and new tasks get detailed explanations
  const notes: string[] = [];
  const missingItems = ki?.missingItems;
  const hasMissing = Array.isArray(missingItems) && missingItems.length > 0;
  const qualStatus = bidder.qualificationStatus || ki?.qualificationStatus;
  const qualifications = extracted?.qualifications as Array<Record<string, any>> | undefined;
  const license = extracted?.license as Record<string, any> | undefined;

  if (!isLow) {
    // ── Qualification analysis ──
    if (qualStatus === '不通过') {
      notes.push(`资格审查结论为"不通过"${hasMissing ? `，缺失项包括：${missingItems!.join('、')}` : '，建议核查投标文件中的资质证明材料是否齐全'}。`);
    } else if (qualStatus === '待审查') {
      notes.push(`资格审查尚未完成${hasMissing ? `，需核对：${missingItems!.join('、')}` : '，建议补充相关证明材料后重新评估'}。`);
    } else if (qualStatus === '通过') {
      // "通过" but elevated risk — check for missing items or data gaps
      const gaps: string[] = [];
      if (hasMissing) gaps.push(`存在缺失项：${missingItems!.join('、')}`);
      if (!ki?.qualificationLevel) gaps.push('未提取到资质等级');
      if (!ki?.qualificationName) gaps.push('未提取到资质名称');
      if (!ki?.registeredCapital) gaps.push('未提取到注册资本');
      if (qualifications && qualifications.length === 0) gaps.push('未提取到资质证书详情');
      if (!license?.number) gaps.push('未提取到执照编号');

      if (gaps.length > 0) {
        notes.push(`资格审查结论为"通过"，但提取的数据存在不完整项：${gaps.join('；')}。系统因此标记为需关注，建议人工核实。`);
      } else {
        notes.push('资格审查结论为"通过"，资质信息提取完整。当前风险标记可能由评分维度触发（见下方分析）。');
      }
    } else if (!qualStatus || qualStatus === 'unknown') {
      notes.push('未获取到有效资格审查结论，可能因投标文件未包含完整资质信息，建议人工核查原件。');
    }

    // ── Qualification certificate details ──
    if (qualifications && qualifications.length > 0) {
      const qualSummaries = qualifications.map((q: any) => {
        const parts = [q.name || '未命名资质'];
        if (q.grade) parts.push(q.grade);
        if (q.validTo) {
          const expired = new Date(q.validTo) < new Date();
          parts.push(expired ? `（已过期 ${q.validTo}）` : `有效期至 ${q.validTo}`);
        }
        return parts.join(' · ');
      });
      notes.push(`提取到 ${qualifications.length} 项资质证书：${qualSummaries.join('；')}。`);
    }

    // ── Technical score analysis ──
    const techScore = bidder.scores?.technical?.totalScore;
    if (techScore != null && techScore < 40) {
      const techBreakdown = bidder.scores?.technical?.breakdown;
      const weakAreas: string[] = [];
      if (techBreakdown) {
        if ((techBreakdown.feasibility?.score ?? 99) < 15) weakAreas.push('施工方案可行性');
        if ((techBreakdown.equipment?.score ?? 99) < 7) weakAreas.push('设备配置');
        if ((techBreakdown.personnel?.score ?? 99) < 7) weakAreas.push('人员配置');
        if ((techBreakdown.guarantee?.score ?? 99) < 7) weakAreas.push('保证措施');
      }
      notes.push(`技术评分偏低（${Number(techScore).toFixed(1)} 分）${weakAreas.length > 0 ? `，低分维度：${weakAreas.join('、')}` : '，建议复核技术方案响应情况'}。`);
    }

    // ── Commercial score analysis ──
    const commScore = bidder.scores?.commercial?.totalScore;
    if (commScore != null && commScore < 24) {
      const commBreakdown = bidder.scores?.commercial?.breakdown;
      const weakAreas: string[] = [];
      if (commBreakdown) {
        if ((commBreakdown.qualification?.score ?? 99) < 7) weakAreas.push('资质情况');
        if ((commBreakdown.performance?.score ?? 99) < 7) weakAreas.push('业绩情况');
        if ((commBreakdown.service?.score ?? 99) < 7) weakAreas.push('服务承诺');
      }
      notes.push(`商务评分偏低（${Number(commScore).toFixed(1)} 分）${weakAreas.length > 0 ? `，低分维度：${weakAreas.join('、')}` : '，建议核查业绩证明、服务承诺等内容'}。`);
    }

    // ── Price risk analysis ──
    const priceRisk = bidder.scores?.price?.riskLevel;
    if (priceRisk === 'high' || priceRisk === 'medium') {
      const priceWarning = bidder.scores?.price?.riskWarning;
      notes.push(`报价风险${priceRisk === 'high' ? '较高' : '需关注'}${priceWarning ? `：${priceWarning}` : '，建议核实报价合理性'}。`);
    }

    // ── Catch-all ──
    if (notes.length === 0) {
      notes.push('风险因素由系统基于多维度评分综合判定，建议人工核查投标文件的资质、报价与技术响应等关键信息。');
    }
  }

  // Focus items for human review
  const focusItems: string[] = [];
  if (!isLow) {
    if (hasMissing) focusItems.push(`核对缺失项：${missingItems!.join('、')}`);
    if (qualifications?.length) {
      const expired = qualifications.filter((q: any) => q.validTo && new Date(q.validTo) < new Date());
      if (expired.length > 0) focusItems.push(`${expired.length} 项资质证书可能已过期`);
    }
    if (ki?.proposedProjectManagerQualification) focusItems.push(`确认项目经理执业资格：${ki.proposedProjectManagerQualification}`);
    if (!ki?.qualificationLevel && !ki?.qualificationName) focusItems.push('资质等级和名称未提取，建议人工核查资质证书');
    if (!license?.number) focusItems.push('执照编号未提取，建议核实营业执照');
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          level === 'HIGH' ? 'bg-red-100 text-red-700' :
          level === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
          'bg-green-100 text-green-700'
        }`}>
          {levelLabel}
        </span>
      </div>

      {factors.length > 0 ? (
        <div className="space-y-1.5">
          {factors.map((f, i) => (
            <div key={i} className="text-xs flex items-start gap-2 leading-5">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                f.severity === 'high' ? 'bg-red-500' : f.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
              }`} />
              <div>
                <span className="font-medium text-slate-800">{f.category}:</span>{' '}
                <span className="text-slate-600">{f.description}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500">
          {isLow
            ? '当前未识别到结构化风险因素，系统基于当前评分、报价与资质信息判断为低风险。'
            : '风险等级已升高，但缺少结构化风险明细，建议人工复核原始投标文件。'}
        </div>
      )}

      {/* Contextual explanation */}
      {notes.length > 0 && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-2.5 text-xs leading-5 text-slate-600 space-y-1">
          <div className="font-medium text-slate-700">风险原因分析</div>
          {notes.map((note, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}

      {/* Human review focus items */}
      {focusItems.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-2.5 text-xs leading-5 text-amber-700 space-y-1">
          <div className="font-medium">建议关注</div>
          {focusItems.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {ra?.summary && (
        <div className="text-xs text-slate-400 border-t border-slate-100 pt-1.5">
          {ra.summary}
        </div>
      )}
    </div>
  );
}

// ─── Score Detail Content ─────────────────────────────────────

function ScoreDetailContent({ bidder }: { bidder: AiBidder }) {
  return (
    <div className="space-y-3">
      <InsightGroup
        title="核心评分"
        badge={`总分 ${bidder.totalScore != null ? Number(bidder.totalScore).toFixed(1) : '-'}`}
        badgeTone="primary"
      >
        <div className="space-y-2.5">
          {/* 技术评分分项 */}
          {bidder.scores?.technical && (
            <CollapsibleSection
              title={`技术评分 (${bidder.scores.technical.totalScore?.toFixed(1) || 0}/50)`}
              accent="#3b82f6"
              defaultOpen
            >
              {bidder.scores.technical.breakdown ? (
                <ScoreBreakdownBars
                  items={[
                    { label: '施工方案可行性', score: bidder.scores.technical.breakdown.feasibility?.score || 0, maxScore: 20, comment: bidder.scores.technical.breakdown.feasibility?.analysis },
                    { label: '设备配置', score: bidder.scores.technical.breakdown.equipment?.score || 0, maxScore: 10, comment: bidder.scores.technical.breakdown.equipment?.analysis },
                    { label: '人员配置', score: bidder.scores.technical.breakdown.personnel?.score || 0, maxScore: 10, comment: bidder.scores.technical.breakdown.personnel?.analysis },
                    { label: '保证措施', score: bidder.scores.technical.breakdown.guarantee?.score || 0, maxScore: 10, comment: bidder.scores.technical.breakdown.guarantee?.analysis },
                  ]}
                  color="#3b82f6"
                />
              ) : (
                <span className="text-xs text-[color:var(--muted-foreground)]">暂无分项数据</span>
              )}
            </CollapsibleSection>
          )}

          {/* 商务评分分项 */}
          {bidder.scores?.commercial && (
            <CollapsibleSection
              title={`商务评分 (${bidder.scores.commercial.totalScore?.toFixed(1) || 0}/30)`}
              accent="#8b5cf6"
              defaultOpen
            >
              {bidder.scores.commercial.breakdown ? (
                <ScoreBreakdownBars
                  items={[
                    { label: '资质情况', score: bidder.scores.commercial.breakdown.qualification?.score || 0, maxScore: 10, comment: bidder.scores.commercial.breakdown.qualification?.analysis },
                    { label: '业绩情况', score: bidder.scores.commercial.breakdown.performance?.score || 0, maxScore: 10, comment: bidder.scores.commercial.breakdown.performance?.analysis },
                    { label: '服务承诺', score: bidder.scores.commercial.breakdown.service?.score || 0, maxScore: 10, comment: bidder.scores.commercial.breakdown.service?.analysis },
                  ]}
                  color="#8b5cf6"
                />
              ) : (
                <span className="text-xs text-[color:var(--muted-foreground)]">暂无分项数据</span>
              )}
            </CollapsibleSection>
          )}

          {/* 报价分析 */}
          {bidder.scores?.price && (
            <CollapsibleSection
              title={`报价分析 (${bidder.scores.price.totalScore?.toFixed(1) || 0}/20)`}
              accent="#10b981"
              defaultOpen
            >
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-[color:var(--muted-foreground)]">报价金额</span>
                    <div className="font-medium">{bidder.scores.price.price?.toFixed(2)}万元</div>
                  </div>
                  <div>
                    <span className="text-xs text-[color:var(--muted-foreground)]">偏离率</span>
                    <div className="font-medium">{bidder.scores.price.deviation || '-'}</div>
                  </div>
                </div>
                {bidder.scores.price.strategyAssessment && (
                  <div className="text-xs leading-5">
                    <span className="font-medium">策略评估: </span>
                    {bidder.scores.price.strategyAssessment.type}
                    <span className="ml-2 text-[color:var(--muted-foreground)]">(置信度: {bidder.scores.price.strategyAssessment.confidence}%)</span>
                  </div>
                )}
                {bidder.scores.price.riskWarning && (
                  <div className="text-xs text-amber-600">{bidder.scores.price.riskWarning}</div>
                )}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </InsightGroup>

      <InsightGroup
        title="辅助判断"
        badge="辅助信息"
        badgeTone="secondary"
      >
        <div className="space-y-2.5">
          {/* 资格性审查 */}
          <CollapsibleSection
            title="资格性审查"
            icon={<Shield className="w-4 h-4 text-blue-500" />}
            defaultOpen
          >
            <QualificationDetail bidder={bidder} />
          </CollapsibleSection>

          {/* 风险分析 */}
          <CollapsibleSection
            title="风险分析"
            icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
            accent="#f59e0b"
            defaultOpen
          >
            <RiskDetail bidder={bidder} />
          </CollapsibleSection>

          {/* 综合评价 */}
          {bidder.overallComment && (
            <div className="rounded-[16px] border border-[rgba(205,218,238,0.42)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,249,255,0.94))] px-4 py-3.5 shadow-[0_4px_14px_rgba(79,108,161,0.05)]">
              <h5 className="text-sm font-semibold text-[color:var(--foreground)]">综合评价</h5>
              <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted-foreground)]">{neutralizeRecommendationText(bidder.overallComment)}</p>
            </div>
          )}
        </div>
      </InsightGroup>
    </div>
  );
}

function InsightGroup({
  eyebrow,
  title,
  badge,
  badgeTone = 'primary',
  children,
}: {
  eyebrow?: string;
  title: string;
  badge?: string;
  badgeTone?: 'primary' | 'secondary';
  children: React.ReactNode;
}) {
  const badgeClass = badgeTone === 'primary'
    ? 'bg-[rgba(96,139,239,0.08)] text-[rgba(96,139,239,0.92)]'
    : 'bg-[rgba(119,129,219,0.08)] text-[rgba(119,129,219,0.9)]';

  return (
    <div className="rounded-[18px] border border-[rgba(204,216,238,0.46)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,249,255,0.95))] p-4 shadow-[0_4px_16px_rgba(79,108,161,0.06)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[rgba(96,139,239,0.8)]">{eyebrow}</div>
          <h4 className="mt-0.5 text-[0.97rem] font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">{title}</h4>
        </div>
        {badge ? (
          <div className={`rounded-full px-3 py-1 text-[11px] font-semibold ${badgeClass}`}>
            {badge}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ─── Strengths & Weaknesses Content ───────────────────────────

const DIMENSION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  qualification: { label: '资质', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200' },
  technical:     { label: '技术', color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200' },
  commercial:   { label: '商务', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
  price:        { label: '报价', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  risk:         { label: '风险', color: 'text-rose-600',   bg: 'bg-rose-50 border-rose-200' },
};

function DimensionBadge({ dimension }: { dimension: string }) {
  const cfg = DIMENSION_CONFIG[dimension] ?? DIMENSION_CONFIG.technical;
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function SwItemCard({ item, type }: { item: StrengthOrWeakness; type: 'strength' | 'weakness' }) {
  const [expanded, setExpanded] = useState(false);
  const hasExtra = item.evidence || item.impact;

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      type === 'strength'
        ? 'bg-[rgba(92,181,150,0.04)] border-[rgba(92,181,150,0.18)] hover:border-[rgba(92,181,150,0.35)]'
        : 'bg-[rgba(234,188,110,0.04)] border-[rgba(234,188,110,0.18)] hover:border-[rgba(234,188,110,0.35)]'
    }`}>
      <div className="flex items-center gap-2 mb-1.5">
        <DimensionBadge dimension={item.dimension} />
        <span className="text-sm font-semibold text-[color:var(--foreground)]">{neutralizeRecommendationText(item.title)}</span>
      </div>
      <p className="text-sm text-[color:var(--muted-foreground)] leading-relaxed">{neutralizeRecommendationText(item.detail)}</p>
      {hasExtra && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? '收起' : '查看证据与影响'}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-[rgba(160,175,200,0.25)]">
              {item.evidence && (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  <span className="font-medium text-[color:var(--foreground)]">证据：</span>{neutralizeRecommendationText(item.evidence)}
                </p>
              )}
              {item.impact && (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  <span className="font-medium text-[color:var(--foreground)]">影响：</span>{neutralizeRecommendationText(item.impact)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StrengthsWeaknessesContent({ bidder }: { bidder: AiBidder }) {
  const ca = bidder.competitiveAnalysis;

  // Fallback: legacy flat string arrays
  if (!ca || (!ca.strengths?.length && !ca.weaknesses?.length)) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-[rgba(92,181,150,0.08)] border border-[rgba(92,181,150,0.2)]">
          <h5 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[rgba(92,181,150,1)]">
            <CheckCircle className="w-4 h-4" /> 正向依据
          </h5>
          {bidder.strengths?.length ? (
            <ul className="space-y-2">
              {bidder.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5 flex-shrink-0">+</span>
                  <span className="text-[color:var(--foreground)]">{neutralizeRecommendationText(s)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-[color:var(--muted-foreground)]">暂无正向依据项</span>
          )}
        </div>
        <div className="p-4 rounded-lg bg-[rgba(234,188,110,0.08)] border border-[rgba(234,188,110,0.2)]">
          <h5 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[rgba(234,188,110,1)]">
            <AlertTriangle className="w-4 h-4" /> 需关注项
          </h5>
          {bidder.weaknesses?.length ? (
            <ul className="space-y-2">
              {bidder.weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-500 mt-0.5 flex-shrink-0">-</span>
                  <span className="text-[color:var(--foreground)]">{neutralizeRecommendationText(w)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-[color:var(--muted-foreground)]">暂无需关注项</span>
          )}
        </div>
      </div>
    );
  }

  // Structured view from competitiveAnalysis
  return (
    <div className="space-y-4">
      {/* Key Observations */}
      {ca.keyObservations?.length > 0 && (
        <div className="rounded-lg bg-[rgba(96,139,239,0.06)] border border-[rgba(96,139,239,0.15)] px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[rgba(96,139,239,0.85)] mb-2">
            <AlertCircle className="w-3.5 h-3.5" />
            关键观察
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ca.keyObservations.map((obs, i) => (
              <span key={i} className="text-sm text-[color:var(--foreground)] flex items-start gap-1.5">
                <span className="text-[rgba(96,139,239,0.6)] mt-1.5 flex-shrink-0">●</span>
                {neutralizeRecommendationText(obs)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h5 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[rgba(92,181,150,1)]">
            <CheckCircle className="w-4 h-4" /> 正向依据
          </h5>
          {ca.strengths.length > 0 ? (
            <div className="space-y-2.5">
              {ca.strengths.map((s, i) => <SwItemCard key={i} item={s} type="strength" />)}
            </div>
          ) : (
            <span className="text-xs text-[color:var(--muted-foreground)]">暂无正向依据项</span>
          )}
        </div>
        <div>
          <h5 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[rgba(234,188,110,1)]">
            <AlertTriangle className="w-4 h-4" /> 需关注项
          </h5>
          {ca.weaknesses.length > 0 ? (
            <div className="space-y-2.5">
              {ca.weaknesses.map((w, i) => <SwItemCard key={i} item={w} type="weakness" />)}
            </div>
          ) : (
            <span className="text-xs text-[color:var(--muted-foreground)]">暂无需关注项</span>
          )}
        </div>
      </div>

      {/* Overall Comment */}
      {ca.overallComment && (
        <div className="rounded-lg border border-[rgba(160,175,200,0.25)] bg-[rgba(255,255,255,0.6)] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            综合评价
          </div>
          <p className="text-sm text-[color:var(--foreground)] leading-relaxed whitespace-pre-wrap">
            {neutralizeRecommendationText(ca.overallComment)}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Collapsible Section Component ───────────────────────────

function CollapsibleSection({
  title,
  icon,
  accent,
  defaultOpen = false,
  children
}: {
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const accentTone = accent ? `${accent}22` : 'rgba(96,139,239,0.12)';
  const accentLine = accent ?? 'rgba(96,139,239,1)';

  return (
    <div className="overflow-hidden rounded-[16px] border border-[rgba(205,218,238,0.45)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,255,0.95))] shadow-[0_4px_14px_rgba(79,108,161,0.06),inset_0_1px_0_rgba(255,255,255,0.96)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-full overflow-hidden px-4 py-3 text-left transition-colors hover:bg-[rgba(96,139,239,0.04)]"
      >
        <div
          className="absolute inset-x-0 top-0 h-[2px] opacity-80"
          style={{ background: `linear-gradient(90deg, ${accentLine}, transparent)` }}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/70 shadow-[0_3px_10px_rgba(79,108,161,0.08)]"
              style={{ background: `linear-gradient(145deg, ${accentTone}, rgba(255,255,255,0.95))`, color: accentLine }}
            >
              {icon ?? <ChevronRight className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">{title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[rgba(96,139,239,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[rgba(96,139,239,0.82)]">
              {isOpen ? '收起' : '展开'}
            </span>
            <ChevronDown className={`h-4 w-4 text-[color:var(--muted-foreground)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-[rgba(205,218,238,0.4)] bg-[linear-gradient(180deg,rgba(251,253,255,0.86),rgba(246,249,255,0.96))] px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}
