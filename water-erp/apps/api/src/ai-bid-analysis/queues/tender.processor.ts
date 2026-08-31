// apps/api/src/ai-bid-analysis/queues/tender.processor.ts
// ★ ERP per-item 重写（Phase 5）：fetchTenderPlaintext → OCR → extract requirements
//   → ScoreCriteriaInferer（推断评分细则）→ 入队 bidderResults（非 procurement 的 bidders）
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../../local-ai/ocr.service';
import { TenderExtractorService } from '../services/tender-extractor.service';
import { ScoreCriteriaInfererService } from '../services/score-criteria-inferer.service';
import { PlaintextFetcherService } from '../services/plaintext-fetcher.service';
import { LlmService } from '../../local-ai/llm.service';
import { REQUIREMENT_VALIDATION_PROMPT } from '../prompts/tender-requirements.prompt';
import { AiAnalysisTaskStatus } from '@prisma/client';
import { QUEUE_NAMES } from './queue.module';
import { processFile } from '../utils/file-processor';

interface TenderJobData {
  taskId: string;
}

@Processor(QUEUE_NAMES.TENDER_PROCESSING)
export class TenderProcessor extends WorkerHost {
  private readonly logger = new Logger(TenderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private tenderExtractor: TenderExtractorService,
    private scoreCriteriaInferer: ScoreCriteriaInfererService,
    private llmService: LlmService,
    private plaintextFetcher: PlaintextFetcherService,
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING)
    private bidderQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<TenderJobData>) {
    const { taskId } = job.data;
    this.logger.log(`Processing tender for task ${taskId}`);

    try {
      const task = await this.prisma.aiBidAnalysisTask.findUnique({
        where: { id: taskId },
      });
      if (!task) throw new Error(`Task ${taskId} not found`);

      await this.updateTaskStatus(taskId, AiAnalysisTaskStatus.TENDER_PROCESSING);

      // 1. 招标文件明文：优先用已存的 tenderText；否则 fetchTenderPlaintext（解密招标文件）→ OCR
      let tenderText = task.tenderText ?? null;
      let tenderPages: any = task.tenderPages;
      if (!tenderText) {
        const buffer = await this.plaintextFetcher.fetchTenderPlaintext(task.projectId);
        if (buffer) {
          const ocrResult = await processFile(this.ocrService, buffer, 'tender.pdf');
          tenderText = ocrResult.text;
          tenderPages = ocrResult.pages;
        } else {
          // fetchTenderPlaintext 链路未就绪（TODO）：跳过招标提取，bidder 处理时降级
          this.logger.warn(`Task ${taskId}: fetchTenderPlaintext 未就绪，跳过招标要求提取`);
        }
      }

      // 2. 提取招标要求（qualification/technical/commercial/scoringRules）
      // C11 (15.9): 纳入已回复的澄清答疑，增强需求提取完整性
      let requirements: any = task.requirements;
      if (tenderText && !requirements) {
        let extractionText = (tenderPages && Array.isArray(tenderPages) && tenderPages.length > 0)
          ? tenderPages.map((p: any) => `【第${p.page}页】\n${p.text}`).join('\n\n')
          : tenderText;
        const clarifications = await this.prisma.bidClarification.findMany({
          where: { projectId: task.projectId, status: '已回复' },
          select: { question: true, reply: true, supplierName: true },
        });
        if (clarifications.length > 0) {
          const clarificationText = clarifications
            .map((c) => `【澄清答疑-${c.supplierName}】\n问：${c.question}\n答：${c.reply}`)
            .join('\n\n');
          extractionText = `${extractionText}\n\n=== 澄清答疑（${clarifications.length} 条） ===\n${clarificationText}`;
          this.logger.log(`Task ${taskId}: merged ${clarifications.length} clarifications into extraction text`);
        }
        requirements = await this.tenderExtractor.extract(extractionText, taskId);
        // 后处理：LLM 标注 sourcePage 不可靠（幻觉），改用原文搜索确定页码
        if (requirements && tenderPages && Array.isArray(tenderPages)) {
          const setPage = (arr: any[]) => arr?.forEach((item: any) => {
            if (typeof item.sourcePage !== 'number' || item.sourcePage < 1) {
              item.sourcePage = 1;
            }
            // 用 content 渐进搜索（降级：40→25→15 字），去掉空白后匹配
            if (item.content && tenderPages.length > 0) {
              const norm = (s: string) => s.replace(/\s+/g, '');
              const txt = (item.content as string);
              for (const len of [40, 25, 15]) {
                const needle = norm(txt.slice(0, len));
                if (!needle) continue;
                let found = false;
                for (const pg of tenderPages) {
                  if (pg.text && norm(pg.text).includes(needle)) {
                    item.sourcePage = pg.page;
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
            }
          });
          setPage(requirements.qualificationRequirements);
          setPage(requirements.technicalRequirements);
          setPage(requirements.commercialRequirements);

          // AI 审查：过滤不适合条款清单的条目（跨引用/法律兜底/流程说明）
          try {
            const allItems = [
              ...(requirements.qualificationRequirements || []).map((r: any) => ({ ...r, _cat: 'qualification' })),
              ...(requirements.technicalRequirements || []).map((r: any) => ({ ...r, _cat: 'technical' })),
              ...(requirements.commercialRequirements || []).map((r: any) => ({ ...r, _cat: 'commercial' })),
            ];
            if (allItems.length > 0) {
              const validation = await this.llmService.chatJson<{ keep: string[] }>(
                '你是招标文件审核专家，逐条判断每条是否属于可供专家核对的评审条款。',
                REQUIREMENT_VALIDATION_PROMPT.replace(
                  '{{ITEMS}}',
                  JSON.stringify(allItems.map((r: any) => ({
                    id: r.id,
                    category: r.category || r._cat,
                    isStarred: r.isStarred || false,
                    content: (r.content || '').slice(0, 100),
                  }))),
                ),
                0,
              );
              if (validation?.keep?.length) {
                const keepIds = new Set(validation.keep);
                const filterArr = (arr: any[]) => arr?.filter((r: any) => keepIds.has(r.id));
                requirements.qualificationRequirements = filterArr(requirements.qualificationRequirements);
                requirements.technicalRequirements = filterArr(requirements.technicalRequirements);
                requirements.commercialRequirements = filterArr(requirements.commercialRequirements);
                const before = allItems.length;
                const after = keepIds.size;
                this.logger.log(`AI 审查过滤 ${before}→${after} 条（剔除 ${before - after} 条）`);
              }
            }
          } catch (e) {
            this.logger.warn(`AI 审查过滤失败，保留全部: ${String(e).slice(0, 100)}`);
          }
        }
      }

      // 3. ScoreCriteriaInferer：为缺细则的评分项推断 scoringCriteria（存 snapshot，不回填 BidScoreItem）
      let scoringCriteriaSnapshot: any = task.scoringCriteriaSnapshot;
      if (tenderText && !scoringCriteriaSnapshot) {
        const scoreItems = await this.prisma.bidScoreItem.findMany({
          where: { projectId: task.projectId },
        });
        scoringCriteriaSnapshot = await this.scoreCriteriaInferer.infer(
          taskId,
          scoreItems,
          tenderText,
          requirements,
        );
      }

      // 4. 保存 + 状态 → ANALYZING
      await this.prisma.aiBidAnalysisTask.update({
        where: { id: taskId },
        data: {
          ...(tenderText ? { tenderText } : {}),
          ...(tenderPages ? { tenderPages } : {}),
          ...(requirements ? { requirements } : {}),
          ...(scoringCriteriaSnapshot
            ? { scoringCriteriaSnapshot }
            : {}),
          status: AiAnalysisTaskStatus.ANALYZING,
        },
      });

      // 5. 入队所有 PENDING bidderResults（非 procurement 的 bidders）
      const bidderResults = await this.prisma.aiBidderResult.findMany({
        where: { taskId, status: 'PENDING' },
        select: { id: true },
      });
      for (const br of bidderResults) {
        const jobId = `bidderResult-${br.id}`;
        // F7：add 前强制 remove——BullMQ 对任意保留状态（含 7 天内 completed）的同 id job 静默去重，
        // 不 remove 的话同 id 二次入队会静默 no-op（假成功）
        await this.bidderQueue.remove(jobId).catch(() => {});
        await this.bidderQueue.add(
          'process',
          { bidderResultId: br.id, taskId },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 7 * 24 * 3600 },
            removeOnFail: { age: 30 * 24 * 3600 },
          },
        );
      }

      this.logger.log(
        `Tender processed for task ${taskId}, queued ${bidderResults.length} bidderResults`,
      );
      return { success: true, taskId };
    } catch (error) {
      this.logger.error(`Failed tender for task ${taskId}: ${error}`);
      await this.updateTaskStatus(taskId, AiAnalysisTaskStatus.FAILED);
      throw error;
    }
  }

  private async updateTaskStatus(taskId: string, status: AiAnalysisTaskStatus) {
    const data: any = { status };
    if (
      status === AiAnalysisTaskStatus.COMPLETED ||
      status === AiAnalysisTaskStatus.COMPLETED_WITH_ERRORS
    ) {
      data.completedAt = new Date();
    }
    await this.prisma.aiBidAnalysisTask.update({ where: { id: taskId }, data });
  }
}
