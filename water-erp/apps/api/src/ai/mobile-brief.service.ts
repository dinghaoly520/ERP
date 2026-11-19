import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ProgressService, STAGE_LABELS } from '../progress/progress.service';
import { CompanyScopeService } from '../company/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import { readInsightCache, writeInsightCache } from '../common/company-data-fingerprint';
import type { AuthenticatedUser } from '../auth/auth.types';

export type BriefFocus = { text: string; jump: '/ledger' | '/progress' };
export type MobileBriefResult =
  | { available: true; focus: BriefFocus | null }
  | { available: false };

/** 阶段拥堵判定阈值：分布最大阶段 ≥ 此值才算「事项」（1~2 项称拥堵是 AI 夸张） */
export const CONGESTION_THRESHOLD = 3;

/** getDashboard 返回的结构化取值（未导出类型，仅声明本服务消费的字段；缺字段走 ?? 兜底） */
type BriefDashboardData = {
  riskProjects?: Array<{ project: string; pendingDays: number; reason: string }>;
};

/** 阶段分布（最堵阶段输入）条目——getDashboard 无此字段，来源 ProgressService.getProgressStats */
type BriefStageDistribution = Array<{ stage: string; stageName?: string; count: number }>;

/** 单句出口净化：禁词替换/剥引号/截断 40 字 */
export function sanitizeBriefText(raw: string): string {
  const t = raw
    .replace(/^[\s"'「」『』“”‘’]+|[\s"'「」『』“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/审批/g, '查阅')
    .trim();
  return t.length > 40 ? t.slice(0, 40) : t;
}

@Injectable()
export class MobileBriefService {
  private readonly logger = new Logger(MobileBriefService.name);
  /** 数据指纹缓存命名空间（v2=2026-11-18 关注条改版——三句→一行事实句，旧缓存不复用） */
  private static readonly BRIEF_CACHE_NS = 'mobile-brief:v2';

  constructor(
    private readonly llm: LlmService,
    private readonly dashboard: DashboardService,
    private readonly companyScope: CompanyScopeService,
    private readonly progress: ProgressService,
    private readonly prisma: PrismaService,
  ) {}

  async getBrief(
    user: AuthenticatedUser,
    companyId?: string,
    startDate?: string,
    endDate?: string,
    rangeKey?: string,
    portalSource?: string,
  ): Promise<MobileBriefResult> {
    /* :3011 总数据（2026-11-04 门户级落地）：来源头穿参，leader/staff 无显式
     * 公司筛选时全库口径（与页面 /dashboard 同视野）。 */
    const scope = await this.companyScope.resolveScope(user, companyId, portalSource);
    const filter = this.companyScope.filter(scope);
    /* 数据指纹缓存（2026-11-12 用户裁定「数据变才变，拒绝时间窗」）：变体=full——
     * 关注条吃台账风险 + PMI 阶段分布两面，PMI 写入也须失效。 */
    const scopeKey = scope.all ? 'all' : scope.companyIds.slice().sort().join(',');
    const cached = await readInsightCache(
      this.prisma, MobileBriefService.BRIEF_CACHE_NS, scopeKey, startDate, endDate, 'full',
    );
    if (cached.hit) return cached.result as MobileBriefResult;

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const rangeStart = startDate ?? monthStart;
    const data = (await this.dashboard.getDashboard(rangeStart, endDate, filter)) as BriefDashboardData;
    const progressStats = (await this.progress.getProgressStats(undefined, undefined, filter)) as {
      stageDistribution?: BriefStageDistribution;
    };

    const risks = (data.riskProjects ?? []).slice(0, 3);
    const stageMax = (progressStats.stageDistribution ?? []).slice().sort((a, b) => b.count - a.count)[0];
    const congested = stageMax != null && stageMax.count >= CONGESTION_THRESHOLD;

    /* 无事项（2026-11-18 用户裁定「AI 感太重」）：无风险且拥堵未达阈值 →
     * focus:null 直接返回，零 LLM 调用——无事不生成「今日无风险项目…」式填充句 */
    if (risks.length === 0 && !congested) {
      const idle: MobileBriefResult = { available: true, focus: null };
      await writeInsightCache(
        this.prisma, MobileBriefService.BRIEF_CACHE_NS, scopeKey, idle, startDate, endDate, 'full',
      ).catch(() => undefined);
      return idle;
    }

    const riskText = risks.map((r) => `${r.project}（滞留${r.pendingDays}天，${r.reason}）`).join('；') || '无';
    const stageText = stageMax
      ? `${STAGE_LABELS[stageMax.stage] ?? stageMax.stageName ?? stageMax.stage}（${stageMax.count}项）`
      : '无';

    try {
      const r = await this.llm.chatJson(
        [
          '你是采购平台驾驶舱的值情员，只陈述事实。根据给定数据输出一行「今日关注」：',
          '{"focus": "事项描述"}',
          '规则：只写最需要领导关注的一个事项，风险项目优先于阶段拥堵；纯事实，必须含项目名与数字；每句 ≤30 字；',
          '数据中无风险且无拥堵时返回 {"focus": null}；禁止建议性套话（「需关注」「建议」「请尽快」等）；禁止编造未提供的数据。',
        ].join(''),
        `风险项目：${riskText}。最堵阶段：${stageText}。`,
        0.4,
        undefined,
        Math.floor(Math.random() * 1_000_000),
        { maxTokens: 4096, timeoutMs: 20_000, retries: 1 },
      );
      // 形状归一（2026-11-03 教训）：{"focus":"…"} 扁平形状与 null 均接受
      const rawFocus = (r as any).focus;
      const text = rawFocus == null ? '' : sanitizeBriefText(String(rawFocus && typeof rawFocus === 'object' ? (rawFocus as { text?: unknown }).text : rawFocus));
      if (!text) {
        /* LLM 依数据自判无事——与前置无事路径同为合法缓存态，免得同数据反复触达 LLM */
        const idle: MobileBriefResult = { available: true, focus: null };
        await writeInsightCache(
          this.prisma, MobileBriefService.BRIEF_CACHE_NS, scopeKey, idle, startDate, endDate, 'full',
        ).catch(() => undefined);
        return idle;
      }
      const result: MobileBriefResult = {
        available: true,
        focus: { text, jump: risks.length > 0 ? '/ledger' : '/progress' },
      };
      await writeInsightCache(
        this.prisma, MobileBriefService.BRIEF_CACHE_NS, scopeKey, result, startDate, endDate, 'full',
      ).catch(() => undefined);
      return result;
    } catch (err) {
      this.logger.warn(`今日关注生成失败：${err instanceof Error ? err.message : err}`);
      return { available: false };
    }
  }
}
