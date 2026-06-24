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
import { AiBidderStatus } from '@prisma/client';
import { QUEUE_NAMES } from './queue.module';
import { processFile } from '../utils/file-processor';

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
          overallComment: scoreResult.overallComment,
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

      // TODO Phase 5 后续/2.4: 第二轮横向（comparativeScoring per-item）+ report 生成
      return { success: true, bidderResultId, totalScore: scoreResult.totalScore };
    } catch (error) {
      this.logger.error(`Failed bidderResult ${bidderResultId}: ${error}`);
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.FAILED);
      throw error;
    }
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
