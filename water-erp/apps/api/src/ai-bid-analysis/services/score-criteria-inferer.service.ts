// apps/api/src/ai-bid-analysis/services/score-criteria-inferer.service.ts
// 评分标准推断（方案 6.2 层②）：为缺细则的评分项，AI 从招标文件推断 scoringCriteria
// 结果存 task.scoringCriteriaSnapshot（不回填 BidScoreItem，见方案 15.8）
import { Injectable, Logger } from '@nestjs/common';
import type { BidScoreItem } from '@prisma/client';
import { LlmService } from '../../local-ai/llm.service';
import { SCORE_CRITERIA_INFER_PROMPT } from '../prompts/score-criteria.prompt';
import { deterministicSeed } from '../utils';

/** scoreItemId → 推断的细则（存 AiBidAnalysisTask.scoringCriteriaSnapshot） */
export type ScoringCriteriaSnapshot = Record<
  string,
  { scoringCriteria: string; evidenceHint: string }
>;

@Injectable()
export class ScoreCriteriaInfererService {
  private readonly logger = new Logger(ScoreCriteriaInfererService.name);

  constructor(private llm: LlmService) {}

  /**
   * 为缺 scoringCriteria 的评分项推断细则
   * @returns snapshot（scoreItemId → {scoringCriteria, evidenceHint}）
   */
  async infer(
    taskId: string,
    scoreItems: BidScoreItem[],
    tenderText: string | null,
    requirements: any,
  ): Promise<ScoringCriteriaSnapshot> {
    // 仅推断管理员未填细则的项
    const needInfer = scoreItems.filter((si) => !si.scoringCriteria);
    if (needInfer.length === 0) {
      this.logger.log(`Task ${taskId}: 所有评分项已有细则，跳过推断`);
      return {};
    }

    const result = await this.llm.chatJson<{
      items: Array<{
        scoreItemId: string;
        scoringCriteria: string;
        evidenceHint: string;
      }>;
    }>(
      '你是评标专家。为评分项推断评分细则。',
      SCORE_CRITERIA_INFER_PROMPT.replace(
        '{{SCORE_ITEMS}}',
        JSON.stringify(
          needInfer.map((si) => ({
            id: si.id,
            category: si.category,
            name: si.name,
            maxScore: Number(si.maxScore),
          })),
        ),
      )
        .replace('{{TENDER_TEXT}}', JSON.stringify((tenderText ?? '').slice(0, 8000)))
        .replace('{{REQUIREMENTS}}', JSON.stringify(requirements ?? {})),
      0,
      undefined,
      deterministicSeed(`${taskId}:criteria`),
    );

    const snapshot: ScoringCriteriaSnapshot = {};
    for (const item of result.items ?? []) {
      snapshot[item.scoreItemId] = {
        scoringCriteria: item.scoringCriteria,
        evidenceHint: item.evidenceHint,
      };
    }

    this.logger.log(
      `Task ${taskId}: 推断 ${Object.keys(snapshot).length}/${needInfer.length} 项评分细则`,
    );
    return snapshot;
  }
}
