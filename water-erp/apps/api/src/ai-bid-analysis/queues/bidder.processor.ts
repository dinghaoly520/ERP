// apps/api/src/ai-bid-analysis/queues/bidder.processor.ts
// ★ ERP per-item 重写（Phase 5）：fetchBidderPlaintext → OCR → extract → SystemData
//   → ConcordanceVerifier → GenericItemScorer(per-item) → 更新 bidderResult COMPLETED
// 取代 procurement 的固定 breakdown（technical/commercial/price scorer）流程
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../../local-ai/ocr.service';
import { BidderExtractorService } from '../services/bidder-extractor.service';
import { PlaintextFetcherService } from '../services/plaintext-fetcher.service';
import { SystemDataAggregatorService } from '../services/system-data-aggregator.service';
import { ConcordanceVerifierService } from '../services/concordance-verifier.service';
import { GenericItemScorerService } from '../services/generic-item-scorer.service';
import { FraudDetectorService } from '../services/fraud-detector.service';
import { ComparativeScoringService } from '../services/comparative-scoring.service';
import { AiBidderStatus } from '@prisma/client';
import { QUEUE_NAMES } from './queue.module';
import { processFile } from '../utils/file-processor';
import { neutralizeRecommendationText } from '../utils/neutralize';

interface BidderJobData {
  bidderResultId: string;
  taskId: string;
}

// concurrency: 2 — DeepSeek + rapid OCR 并行；lockDuration 10min 容忍 LLM/OCR 慢
@Processor(QUEUE_NAMES.BIDDER_PROCESSING, { concurrency: 2, lockDuration: 600000 })
export class BidderProcessor extends WorkerHost {
  private readonly logger = new Logger(BidderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private bidderExtractor: BidderExtractorService,
    private plaintextFetcher: PlaintextFetcherService,
    private systemDataAggregator: SystemDataAggregatorService,
    private concordanceVerifier: ConcordanceVerifierService,
    private genericItemScorer: GenericItemScorerService,
    private fraudDetector: FraudDetectorService,
    private comparativeScoring: ComparativeScoringService,
  ) {
    super();
  }

  async process(job: Job<BidderJobData>) {
    const { bidderResultId, taskId } = job.data;
    this.logger.log(`Processing bidderResult ${bidderResultId} for task ${taskId}`);

    try {
      const bidderResult = await this.prisma.aiBidderResult.findUnique({
        where: { id: bidderResultId },
        include: {
          task: true,
          bidSupplier: { select: { id: true, supplierName: true } },
        },
      });
      if (!bidderResult) {
        throw new Error(`BidderResult ${bidderResultId} not found`);
      }

      const bidSupplierId = bidderResult.bidSupplierId;
      const task = bidderResult.task;

      // 1. fetchBidderPlaintext（technical + business）→ OCR
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.OCR_PROCESSING);

      const techBuffer = await this.plaintextFetcher.fetchBidderPlaintext(
        bidSupplierId,
        'technical',
      );
      const techOcr = await processFile(this.ocrService, techBuffer, 'technical.pdf');

      let businessText: string | null = null;
      try {
        const bizBuffer = await this.plaintextFetcher.fetchBidderPlaintext(
          bidSupplierId,
          'business',
        );
        const bizOcr = await processFile(this.ocrService, bizBuffer, 'business.pdf');
        businessText = bizOcr.text;
      } catch (e) {
        this.logger.warn(
          `bidderResult ${bidderResultId}: business file OCR skipped: ${(e as Error).message}`,
        );
      }

      await this.updateBidderStatus(bidderResultId, AiBidderStatus.OCR_COMPLETED);

      // 2. 提取投标单位关键信息（LLM）
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.EXTRACTING);

      const { keyInfo, extractedInfo } = await this.bidderExtractor.extract(
        techOcr.text,
        bidderResult.bidSupplier.supplierName,
        task.requirements as any,
        taskId,
      );

      await this.prisma.aiBidderResult.update({
        where: { id: bidderResultId },
        data: {
          technicalText: techOcr.text,
          businessText,
          extractedInfo: extractedInfo as any,
          keyInfo: keyInfo as any,
        },
      });

      await this.updateBidderStatus(bidderResultId, AiBidderStatus.EXTRACTED);

      // 3. SystemData 聚合 + 双源一致性校验
      await this.updateBidderStatus(
        bidderResultId,
        AiBidderStatus.CONCORDANCE_CHECKING,
      );

      const systemData = await this.systemDataAggregator.aggregate(bidSupplierId);
      const concordance = this.concordanceVerifier.verify(
        systemData,
        keyInfo as any,
      );

      await this.prisma.aiConcordanceResult.upsert({
        where: { bidderResultId },
        create: {
          taskId,
          bidderResultId,
          overallStatus: concordance.overallStatus,
          conflictCount: concordance.conflictCount,
          warningCount: concordance.warningCount,
          checkedFields: concordance.checks as any,
        },
        update: {
          overallStatus: concordance.overallStatus,
          conflictCount: concordance.conflictCount,
          warningCount: concordance.warningCount,
          checkedFields: concordance.checks as any,
          generatedAt: new Date(),
        },
      });

      // 一致性 → 评分影响（方案 7.3）：报价 conflict → PRICE 项 0 分
      const priceConflict = concordance.checks.some(
        (c) => c.field === 'price' && c.status === 'conflict',
      );

      // 4. GenericItemScorer（per-item 评分）
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.SCORING);

      const scoreItems = await this.prisma.bidScoreItem.findMany({
        where: { projectId: task.projectId },
      });
      // 合并评分细则：管理员填（BidScoreItem.scoringCriteria）+ AI 推断（task.scoringCriteriaSnapshot）
      const snapshot = (task.scoringCriteriaSnapshot ?? {}) as Record<
        string,
        { scoringCriteria?: string; evidenceHint?: string }
      >;
      const itemsWithCriteria = scoreItems.map((si) => ({
        ...si,
        scoringCriteria: si.scoringCriteria || snapshot[si.id]?.scoringCriteria || null,
        evidenceHint: si.evidenceHint || snapshot[si.id]?.evidenceHint || null,
      }));

      // 价格公式基准：所有 bidderResult 的报价（从 keyInfo.quotePrice）
      const allBidderPrices = await this.collectAllPrices(taskId);

      const scoreResult = await this.genericItemScorer.score(
        itemsWithCriteria,
        extractedInfo,
        task.requirements as any,
        taskId,
        bidderResultId,
        priceConflict ? [] : allBidderPrices, // 报价冲突时不给基准（PRICE 项 0 分）
      );

      // 报价冲突：覆盖 PRICE 项为 0（方案 7.3）
      if (priceConflict) {
        scoreResult.scoreItems = scoreResult.scoreItems.map((si) =>
          si.category === 'PRICE'
            ? { ...si, score: 0, reason: '报价一致性冲突，该项 0 分', confidence: 1 }
            : si,
        );
        scoreResult.categoryTotals.PRICE = { score: 0, max: scoreResult.categoryTotals.PRICE?.max ?? 0 };
        scoreResult.totalScore = scoreResult.scoreItems.reduce((a, b) => a + b.score, 0);
      }

      // 5. 资格判定（资质 conflict → 不通过）
      const qualConflict = concordance.checks.some(
        (c) => c.field === 'qualification' && c.status === 'conflict',
      );
      const qualificationStatus = qualConflict ? '不通过' : '通过';
      const riskLevel =
        concordance.conflictCount > 0
          ? 'high'
          : concordance.warningCount > 0
            ? 'medium'
            : 'low';

      await this.prisma.aiBidderResult.update({
        where: { id: bidderResultId },
        data: {
          systemInfo: systemData as any,
          scoreItems: scoreResult.scoreItems as any,
          categoryTotals: scoreResult.categoryTotals as any,
          totalScore: scoreResult.totalScore,
          overallComment: neutralizeRecommendationText(scoreResult.overallComment),
          qualificationStatus,
          riskLevel,
          riskAnalysis: {
            concordanceStatus: concordance.overallStatus,
            conflictCount: concordance.conflictCount,
            warningCount: concordance.warningCount,
          } as any,
          status: AiBidderStatus.COMPLETED,
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `bidderResult ${bidderResultId} COMPLETED: totalScore=${scoreResult.totalScore}, concordance=${concordance.overallStatus}`,
      );

      // 15.6: 检查全部终态 → 触发横向评分 + 更新 task 终态
      await this.checkTaskCompletion(taskId);

      return { success: true, bidderResultId, totalScore: scoreResult.totalScore };
    } catch (error) {
      this.logger.error(`Failed bidderResult ${bidderResultId}: ${error}`);
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.FAILED);
      // 15.6: 即使失败也检查任务终态（部分失败容忍）
      await this.checkTaskCompletion(taskId);
      throw error;
    }
  }

  /**
   * 15.6: 检查任务是否全部终态（COMPLETED/FAILED）
   * - 全部终态 → 横向对比评分（comparativeScoring）+ 串通检测（fraudDetector）+ 更新 task 终态
   */
  private async checkTaskCompletion(taskId: string): Promise<void> {
    const all = await this.prisma.aiBidderResult.findMany({
      where: { taskId },
      select: { status: true },
    });
    const completed = all.filter((r) => r.status === 'COMPLETED');
    const failed = all.filter((r) => r.status === 'FAILED');
    const pending = all.filter((r) => r.status !== 'COMPLETED' && r.status !== 'FAILED');

    if (pending.length > 0) return;

    // ≥2 COMPLETED → 横向对比评分
    if (completed.length >= 2) {
      try {
        this.logger.log(`Task ${taskId}: running comparative scoring (${completed.length} bidders)`);
        await this.comparativeScoring.score(taskId);
      } catch (e) {
        this.logger.warn(`Task ${taskId}: comparative scoring failed: ${e}`);
      }
    }

    // 串通检测（B5）：需要 ≥2 bidder 的 keyInfo/text
    if (completed.length >= 2) {
      try {
        this.logger.log(`Task ${taskId}: running fraud detection`);
        const bidderData = await this.prisma.aiBidderResult.findMany({
          where: { taskId, status: 'COMPLETED' },
          select: { id: true, keyInfo: true, technicalText: true, bidSupplier: { select: { supplierName: true } } },
        });
        const fraudIndicators = await this.fraudDetector.detect(
          bidderData.map((b) => ({
            id: b.id,
            name: b.bidSupplier.supplierName,
            keyInfo: b.keyInfo as any,
            text: b.technicalText ?? undefined,
          })),
        );
        // 存入 AiBidReport
        await this.prisma.aiBidReport.upsert({
          where: { taskId },
          create: { taskId, fraudIndicators: fraudIndicators as any },
          update: { fraudIndicators: fraudIndicators as any },
        });
        this.logger.log(`Task ${taskId}: fraud detection done, risk=${fraudIndicators.riskLevel}, indicators=${fraudIndicators.indicators.length}`);
      } catch (e) {
        this.logger.warn(`Task ${taskId}: fraud detection failed: ${e}`);
      }
    }

    // 更新 task 终态
    const hasFailed = failed.length > 0;
    await this.prisma.aiBidAnalysisTask.update({
      where: { id: taskId },
      data: {
        status: hasFailed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        completedAt: new Date(),
      },
    });
    this.logger.log(`Task ${taskId}: ${hasFailed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'} (${completed.length} ok, ${failed.length} failed)`);
  }

  /** 收集任务下所有 bidderResult 的报价（价格公式基准） */
  private async collectAllPrices(taskId: string): Promise<number[]> {
    const results = await this.prisma.aiBidderResult.findMany({
      where: { taskId, keyInfo: { not: null as any } },
      select: { keyInfo: true },
    });
    return results
      .map((r) => (r.keyInfo as any)?.quotePrice as number | undefined)
      .filter((p): p is number => typeof p === 'number' && p > 0);
  }

  private async updateBidderStatus(bidderResultId: string, status: AiBidderStatus) {
    await this.prisma.aiBidderResult.update({
      where: { id: bidderResultId },
      data: { status },
    });
  }
}
