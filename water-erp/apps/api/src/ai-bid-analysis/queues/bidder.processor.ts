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
import { CompetitiveAnalysisService } from '../services/competitive-analysis.service';
import { ReportGeneratorService } from '../services/report-generator.service';
import { DocxGeneratorService } from '../services/docx-generator.service';
import { RequirementMatcherService } from '../services/requirement-matcher.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from '../../upload/minio.client';
import { AiBidderStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { QUEUE_NAMES } from './queue.module';
import { processFile } from '../utils/file-processor';
import { neutralizeRecommendationText } from '../utils/neutralize';
import { resolveQualification } from '../utils/qualification';

interface BidderJobData {
  bidderResultId: string;
  taskId: string;
}

// concurrency 默认 2（AI_BID_WORKER_CONCURRENCY 可调）— DeepSeek + rapid OCR 并行；lockDuration 10min 容忍 LLM/OCR 慢
// 水平扩容：直接多开 worker 进程即可（BullMQ 同队列多 worker 天然分担、jobId 去重），见 docs/ops-scaling.md
@Processor(QUEUE_NAMES.BIDDER_PROCESSING, {
  concurrency: Math.max(1, Number(process.env.AI_BID_WORKER_CONCURRENCY) || 2),
  lockDuration: 600000,
})
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
    private competitiveAnalysis: CompetitiveAnalysisService,
    private reportGenerator: ReportGeneratorService,
    private docxGenerator: DocxGeneratorService,
    private requirementMatcher: RequirementMatcherService,
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

      // Task 4: 外层声明 fileId / bizOcr，Task 7 matcher 将消费它们做跳转定位
      let bizOcr: any = null;
      let techFileId: string | null = null;
      let bizFileId: string | null = null;

      // 1. fetchBidderPlaintext（technical + business）→ OCR
      await this.updateBidderStatus(bidderResultId, AiBidderStatus.OCR_PROCESSING);

      const tech = await this.plaintextFetcher.fetchBidderPlaintext(
        bidSupplierId,
        'technical',
      );
      const techBuffer = tech?.buffer ?? Buffer.from('');
      techFileId = tech?.fileId ?? null;
      const techOcr = await processFile(this.ocrService, techBuffer, 'technical.pdf');

      let businessText: string | null = null;
      try {
        const biz = await this.plaintextFetcher.fetchBidderPlaintext(
          bidSupplierId,
          'business',
        );
        const bizBuffer = biz?.buffer ?? Buffer.from('');
        bizFileId = biz?.fileId ?? null;
        bizOcr = await processFile(this.ocrService, bizBuffer, 'business.pdf');
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

      // 5. 资格判定（资质 conflict 或 ★实质性条款未响应 → 不通过）
      const qualConflict = concordance.checks.some(
        (c) => c.field === 'qualification' && c.status === 'conflict',
      );
      const { qualificationStatus, riskLevel, autoNote } = resolveQualification({
        qualConflict,
        starredResponse: scoreResult.starredResponse as
          | { allMet?: boolean; unmet?: string[] }
          | null
          | undefined,
        concordanceConflictCount: concordance.conflictCount,
        concordanceWarningCount: concordance.warningCount,
      });

      // 6. 竞争分析：正向依据 + 需关注事项（LLM）
      let strengths: any[] = [];
      let weaknesses: any[] = [];
      let keyObservations: string[] = [];
      let competitiveComment = scoreResult.overallComment;
      try {
        // 将 per-item categoryTotals 映射为 competitive analysis 期望的三维 scores
        const catScores = scoreResult.categoryTotals ?? {};
        const compScores = {
          technical: catScores.TECHNICAL ?? { score: 0, max: 0 },
          commercial: {
            score: (catScores.BUSINESS?.score ?? 0) + (catScores.QUALIFICATION?.score ?? 0),
            max: (catScores.BUSINESS?.max ?? 0) + (catScores.QUALIFICATION?.max ?? 0),
          },
          price: catScores.PRICE ?? { score: 0, max: 0 },
        };
        const compResult = await this.competitiveAnalysis.analyze(
          bidderResult.bidSupplier.supplierName,
          scoreResult.totalScore,
          compScores,
          keyInfo as any,
          taskId,
          bidderResultId,
        );
        strengths = compResult.strengths;
        weaknesses = compResult.weaknesses;
        keyObservations = compResult.keyObservations;
        competitiveComment = compResult.overallComment || scoreResult.overallComment;
        this.logger.log(
          `bidderResult ${bidderResultId}: competitive analysis done (${strengths.length}S, ${weaknesses.length}W)`,
        );
      } catch (e) {
        this.logger.warn(
          `bidderResult ${bidderResultId}: competitive analysis LLM failed, using score-only comment: ${(e as Error).message.slice(0, 150)}`,
        );
      }

      // Task 7: 条款-响应定位（requirementResponses）— 评分后、final update 前
      let requirementResponses: any[] = [];
      try {
        const techPages = (techOcr.pages ?? []).map((p: any) => ({
          file: 'technical',
          page: p.page,
          text: p.text,
        }));
        const bizPages =
          businessText && bizOcr?.pages
            ? (bizOcr.pages ?? []).map((p: any) => ({
                file: 'business',
                page: p.page,
                text: p.text,
              }))
            : [];
        if (task.requirements) {
          requirementResponses = await this.requirementMatcher.match(
            task.requirements as any,
            [...techPages, ...bizPages],
            { technical: techFileId, business: bizFileId },
            taskId,
          );
        }
      } catch (e) {
        // matcher 失败非致命 — 记日志后继续（不阻塞评分/报告）
        this.logger.warn(
          `bidderResult ${bidderResultId}: requirement matching failed: ${(e as Error).message.slice(0, 150)}`,
        );
      }

      await this.prisma.aiBidderResult.update({
        where: { id: bidderResultId },
        data: {
          systemInfo: systemData as any,
          scoreItems: scoreResult.scoreItems as any,
          categoryTotals: scoreResult.categoryTotals as any,
          starredResponse: scoreResult.starredResponse as any,
          totalScore: scoreResult.totalScore,
          overallComment: autoNote
            ? `${neutralizeRecommendationText(competitiveComment)}\n${autoNote}`
            : neutralizeRecommendationText(competitiveComment),
          qualificationStatus,
          riskLevel,
          riskAnalysis: {
            concordanceStatus: concordance.overallStatus,
            conflictCount: concordance.conflictCount,
            warningCount: concordance.warningCount,
          } as any,
          strengths: strengths as any,
          weaknesses: weaknesses as any,
          competitiveAnalysis: {
            strengths,
            weaknesses,
            keyObservations,
          } as any,
          requirementResponses: requirementResponses as any,
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

    // ★ 价格重算：首轮 per-item 评分时 bidder 并发处理，collectAllPrices 可能返回空数组
    //   此时所有 bidder 的 keyInfo 已保存，重新用公式计算 PRICE 项
    if (completed.length >= 2) {
      try {
        await this.recalculatePrices(taskId);
      } catch (e) {
        this.logger.warn(`Task ${taskId}: price recalculation failed: ${e}`);
      }
    }

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

    // B6: 综合报告 + DOCX 导出 — 所有 bidder 终态后生成
    if (completed.length >= 2) {
      try {
        this.logger.log(`Task ${taskId}: generating comprehensive report`);
        // 取 task（含 project.name）和已完成的 bidder（含 supplierName）
        const task = await this.prisma.aiBidAnalysisTask.findUnique({
          where: { id: taskId },
          include: { project: { select: { name: true } } },
        });
        const bidders = await this.prisma.aiBidderResult.findMany({
          where: { taskId, status: 'COMPLETED' },
          include: { bidSupplier: { select: { supplierName: true } } },
        });
        // 读取已保存的 fraudIndicators
        const existingReport = await this.prisma.aiBidReport.findUnique({
          where: { taskId },
          select: { fraudIndicators: true },
        });
        const fraudIndicators = (existingReport?.fraudIndicators as any) ?? null;

        // 生成报告 JSON
        const reportData = await this.reportGenerator.generate(
          task as any,
          bidders as any,
          fraudIndicators,
        );

        // 生成 DOCX buffer
        const docxBuffer = await this.docxGenerator.generate(reportData as any);

        // 上传 DOCX 到 MinIO
        await ensureBucket();
        const docxKey = `reports/${taskId}/ai-bid-analysis-report.docx`;
        await minioClient.putObject(MINIO_BUCKET, docxKey, docxBuffer, docxBuffer.length, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const sha256 = crypto.createHash('sha256').update(docxBuffer).digest('hex');
        const fileAsset = await this.prisma.fileAsset.create({
          data: {
            key: docxKey,
            originalName: `投标文件分析报告-${task?.project.name ?? taskId}.docx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: docxBuffer.length,
            sha256,
            category: 'general',
          },
        });

        // 合并 reportData + fraudIndicators + docxFileId → upsert AiBidReport
        await this.prisma.aiBidReport.upsert({
          where: { taskId },
          create: {
            taskId,
            ...reportData,
            fraudIndicators: fraudIndicators ?? undefined,
            docxFileId: fileAsset.id,
          } as any,
          update: {
            ...reportData,
            docxFileId: fileAsset.id,
          } as any,
        });
        this.logger.log(`Task ${taskId}: report + DOCX saved (fileId=${fileAsset.id})`);
      } catch (e) {
        this.logger.warn(`Task ${taskId}: report generation failed: ${e}`);
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

  /**
   * 价格重算：所有 bidder 终态后，用完整报价集合按公式重算 PRICE 项得分
   * 解决 bidder 并发处理时 collectAllPrices 返回空数组导致首轮 PRICE=0 的问题
   */
  private async recalculatePrices(taskId: string): Promise<void> {
    const allPrices = await this.collectAllPrices(taskId);
    if (allPrices.length < 2) {
      this.logger.log(`Task ${taskId}: only ${allPrices.length} prices, skip price recalculation`);
      return;
    }

    const benchmark = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    this.logger.log(
      `Task ${taskId}: recalculating prices (${allPrices.length} bidders, benchmark=${benchmark.toFixed(2)})`,
    );

    const bidders = await this.prisma.aiBidderResult.findMany({
      where: { taskId, status: 'COMPLETED' },
      select: { id: true, keyInfo: true, scoreItems: true, categoryTotals: true },
    });

    for (const bidder of bidders) {
      const price = (bidder.keyInfo as any)?.quotePrice as number | undefined;
      if (price == null) continue;

      const scoreItems = (bidder.scoreItems ?? []) as any[];
      const categoryTotals = (bidder.categoryTotals ?? {}) as Record<string, { score: number; max: number }>;

      // 找到 PRICE 项并重算
      let updated = false;
      const newItems = scoreItems.map((item: any) => {
        if (item.category !== 'PRICE') return item;
        // priceConflict 已置 0（bidder.processor 方案7.3，reason 含"报价一致性冲突"）：保持 0 分，不重算
        if (typeof item.reason === 'string' && item.reason.includes('报价一致性冲突')) return item;
        const maxScore = Number(item.maxScore ?? 30);
        const deviation = (price - benchmark) / benchmark;
        const ratio = Math.max(0, 1 - Math.abs(deviation) * 2);
        const newScore = Math.round(maxScore * ratio * 10) / 10;
        updated = true;
        // 方案2：仅重算客观 score；保留 scorePriceWithAnalysis 的 LLM reason/evidence/priceAnalysis
        return { ...item, score: newScore };
      });

      if (!updated) continue;

      // 重算 categoryTotals.PRICE 和 totalScore
      const priceMax = categoryTotals.PRICE?.max ?? 30;
      const newPriceScore = newItems.find((i: any) => i.category === 'PRICE')?.score ?? 0;
      const newTotals = { ...categoryTotals };
      newTotals.PRICE = { score: newPriceScore, max: priceMax };

      const newTotal = Object.values(newTotals).reduce((a, c: any) => a + (c?.score ?? 0), 0);

      await this.prisma.aiBidderResult.update({
        where: { id: bidder.id },
        data: {
          scoreItems: newItems as any,
          categoryTotals: newTotals as any,
          totalScore: Math.round(newTotal * 10) / 10,
        },
      });

      this.logger.log(
        `  ${bidder.id}: PRICE ${price} → ${newPriceScore}/${priceMax}（偏离 ${((price - benchmark) / benchmark * 100).toFixed(1)}%）`,
      );
    }
  }

  private async updateBidderStatus(bidderResultId: string, status: AiBidderStatus) {
    await this.prisma.aiBidderResult.update({
      where: { id: bidderResultId },
      data: { status },
    });
  }
}
