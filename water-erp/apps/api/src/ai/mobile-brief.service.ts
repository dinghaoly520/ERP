import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ProgressService, STAGE_LABELS } from '../progress/progress.service';
import { CompanyScopeService } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';

export type BriefItem = { text: string; jump: '/dashboard' | '/ledger' | '/progress' };
export type MobileBriefResult =
  | { available: true; focus: BriefItem; metric: BriefItem; reminder: BriefItem; shareText: string }
  | { available: false };

/** getDashboard 返回的结构化取值（未导出类型，仅声明本服务消费的字段；缺字段走 ?? 兜底） */
type BriefDashboardData = {
  summary: {
    totalCount: number;
    completedCount: number;
    abnormalCount: number;
    totalAwardLabel: string;
    totalSavingsLabel: string;
  };
  riskProjects?: Array<{ project: string; pendingDays: number; reason: string }>;
  savingsRanking?: Array<{ project: string; savingsRate: number }>;
};

/** 阶段分布（最堵阶段输入）条目——getDashboard 无此字段，来源 ProgressService.getProgressStats */
type BriefStageDistribution = Array<{ stage: string; stageName?: string; count: number }>;

/** 单句出口净化：禁词替换/剥引号/截断 40 字（与 mobile-greeting.sanitize 同规则） */
export function sanitizeBriefText(raw: string): string {
  const t = raw
    .replace(/^[\s"'「」『』“”‘’]+|[\s"'「」『』“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/审批/g, '查阅')
    .trim();
  return t.length > 40 ? t.slice(0, 40) : t;
}

/** shareText 出口净化：同禁词/剥引号/折叠空白规则，但 160 字上限——段落文案（80~120 字规格），
 *  不共用单句 40 字截断（fix round 1：pick() 路径曾把 shareText 压到 40 字，规格永不可达） */
export function sanitizeBriefShareText(raw: string): string {
  const t = raw
    .replace(/^[\s"'「」『』“”‘’]+|[\s"'「」『』“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/审批/g, '查阅')
    .trim();
  return t.length > 160 ? t.slice(0, 160) : t;
}

@Injectable()
export class MobileBriefService {
  private readonly logger = new Logger(MobileBriefService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly dashboard: DashboardService,
    private readonly companyScope: CompanyScopeService,
    private readonly progress: ProgressService,
  ) {}

  async getBrief(user: AuthenticatedUser, companyId?: string): Promise<MobileBriefResult> {
    const scope = await this.companyScope.resolveScope(user, companyId);
    const filter = this.companyScope.filter(scope);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const data = (await this.dashboard.getDashboard(monthStart, undefined, filter)) as BriefDashboardData;
    // 最堵阶段输入：getDashboard 无 stageDistribution，取 ProgressService 阶段分布（同 companyFilter 隔离）
    const progressStats = (await this.progress.getProgressStats(undefined, undefined, filter)) as {
      stageDistribution?: BriefStageDistribution;
    };

    const riskTop = (data.riskProjects ?? []).slice(0, 3)
      .map((r) => `${r.project}（滞留${r.pendingDays}天，${r.reason}）`).join('；') || '无';
    const savingsTop = (data.savingsRanking ?? []).slice(0, 3)
      .map((s) => `${s.project}（节资率${s.savingsRate}%）`).join('；') || '无';
    const stageMax = (progressStats.stageDistribution ?? []).slice().sort((a, b) => b.count - a.count)[0];

    try {
      const r = await this.llm.chatJson(
        [
          '你是「蜀水云采」采购平台给领导写「今日要报」的助手。输出 JSON：',
          '{"focus":{"text":...},"metric":{"text":...},"reminder":{"text":...},"shareText":...}',
          '规则：focus=今天最该关注的一件事（优先风险/停滞，含项目名与天数）；metric=一个关键数字（本月成交额或节资，只用给定数据）；',
          'reminder=一个提醒（阶段拥堵/异常信号）；每句 ≤30 字、只讲需要领导知道的事、禁止 emoji、禁止出现「审批」一词、禁止编造未提供的数据。',
          'shareText=80~120 字一段话，适合发到管理群，含上述三要点，口语但专业。',
        ].join(''),
        `本月数据：总轮次${data.summary.totalCount}，已成交${data.summary.completedCount}，异常${data.summary.abnormalCount}，成交额${data.summary.totalAwardLabel}，累计节资${data.summary.totalSavingsLabel}。风险项目：${riskTop}。节资前三：${savingsTop}。当前最堵阶段：${stageMax ? `${STAGE_LABELS[stageMax.stage] ?? stageMax.stageName ?? stageMax.stage}（${stageMax.count}项）` : '无'}。`,
        0.4,
        undefined,
        Math.floor(Math.random() * 1_000_000),
        { maxTokens: 2048, timeoutMs: 20_000, retries: 1 },
      );
      const pick = (v: unknown): string => sanitizeBriefText(String(v ?? ''));
      const focusText = pick((r as Record<string, unknown>).focus && ((r as any).focus.text));
      const metricText = pick((r as any).metric?.text);
      const reminderText = pick((r as any).reminder?.text);
      const shareText = sanitizeBriefShareText(String((r as any).shareText ?? ''));
      if (!focusText || !metricText || !reminderText) return { available: false };
      return {
        available: true,
        focus: { text: focusText, jump: '/dashboard' },
        metric: { text: metricText, jump: '/ledger' },
        reminder: { text: reminderText, jump: '/progress' },
        shareText: shareText || `${metricText}；${focusText}`,
      };
    } catch (err) {
      this.logger.warn(`今日要报生成失败：${err instanceof Error ? err.message : err}`);
      return { available: false };
    }
  }
}
