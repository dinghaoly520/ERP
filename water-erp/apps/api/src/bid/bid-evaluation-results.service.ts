import { Injectable, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { evaluateBondCompliance } from '@water-erp/shared';
import { aggregateSupplierScores } from './aggregate-supplier-scores';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from './bid.gateway';
import { BidService } from './bid.service'; // 值导入：emitDecoratorMetadata 需运行时引用，import type 会退化为 Object 致 DI 失败
import { lockAndReassertStage } from './bid-state';
import { isBondQualified } from './bid-bond-status';
import { PriceFormulaService } from './price-formula.service';
import { getEvaluationDefault } from './evaluation-method.config';
import { StorageService } from '../storage/storage.service';

/** 评标结果域（F1b）——自 bid.service.ts 迁出（P1 审查 F 簇拆分，纯移动）。索引：listEvaluationResults / generateEvaluationResults / buildEvaluationPackage（+私有 getWinnerCount） */

@Injectable()
export class BidEvaluationResultsService {
  constructor(
    private prisma: PrismaService,
    private readonly priceFormula: PriceFormulaService,
    private readonly storage: StorageService,
    private readonly bidService: BidService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(BidEvaluationResultsService.name);

  /** 生成评标结果时默认标记为候选人（recommended）的名次数 */
  private readonly DEFAULT_WINNER_COUNT = 3;


  /** 评标完整性快照：评审结果生成后、归档前的独立证据包（SHA-256 签名）。 */
  public async buildEvaluationPackage(projectId: string) {
    // BidScoreRecordHistory 无 expert 关系字段，先取项目专家 ID 再过滤
    const expertIds = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { id: true },
    });
    const expertIdSet = new Set(expertIds.map(e => e.id));

    const [records, allHistory, pointDecisions, experts] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expertId: { in: [...expertIdSet] } },
        select: { expertId: true, supplierId: true, scoreItemId: true, score: true, passed: true, reason: true },
      }),
      this.prisma.bidScoreRecordHistory.findMany({
        where: { expertId: { in: [...expertIdSet] } },
        orderBy: { createdAt: 'asc' },
        select: { expertId: true, supplierId: true, scoreItemId: true, score: true, passed: true, action: true, createdAt: true },
      }),
      this.prisma.bidScorePointDecision.findMany({
        where: { expertId: { in: [...expertIdSet] } },
        select: { expertId: true, pointId: true, supplierId: true, checked: true, awardedScore: true },
      }),
      this.prisma.bidExpert.findMany({
        where: { projectId },
        select: { expertName: true, expertRole: true, reportConfirmed: true, reportConfirmedAt: true, progress: true, totalScore: true },
      }),
    ]);
    const body = {
      packageType: 'BID_EVALUATION_HANDOVER',
      packageVersion: 1,
      generatedAt: new Date().toISOString(),
      projectId,
      expertConfirmations: experts.map(e => ({
        expertName: e.expertName, expertRole: e.expertRole,
        reportConfirmed: e.reportConfirmed, reportConfirmedAt: e.reportConfirmedAt?.toISOString() ?? null,
        progress: e.progress, totalScore: Number(e.totalScore),
      })),
      scoreRecords: records.map(r => ({ ...r, score: Number(r.score) })),
      scoreHistory: allHistory.map(h => ({ ...h, score: Number(h.score), createdAt: h.createdAt.toISOString() })),
      pointDecisions: pointDecisions.map(d => ({ ...d, awardedScore: Number(d.awardedScore) })),
    };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return { ...body, fingerprint };
  }


  listEvaluationResults(projectId: string) {
    return this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } });
  }


  /**
   * 按评标办法确定中标候选人数。
   * - 最低价类(lowest_price / qualified_lowest_price) → 1
   * - 综合评估(comprehensive) → 3
   * - 直接采购(none) → 1
   * - 未知 → 回退 DEFAULT_WINNER_COUNT(3)
   */
  private getWinnerCount(procurementMethod: string | null, evaluationMethod: string | null, qualifiedCount: number): number {
    if (qualifiedCount === 0) return 0;
    const method = evaluationMethod ??
      getEvaluationDefault(procurementMethod).evaluationMethod;
    switch (method) {
      case 'lowest_price':
      case 'qualified_lowest_price':
      case 'none':
        return Math.min(1, qualifiedCount);
      case 'comprehensive':
      default:
        return Math.min(this.DEFAULT_WINNER_COUNT, qualifiedCount);
    }
  }


  async generateEvaluationResults(projectId: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { experts: true, suppliers: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
    }
    // P2-4（2026-09-09 审查）：评标超时未审批延期不得生成官方结果——专家侧已被
    // EVALUATION_OVERDUE 拦截交分，此处放行会让主持人以既有分数绕过延期审批闸
    // （expert.service.assertEvaluationNotOverdue 同口径）。出口=extendEvaluation 延期审批。
    if (project.evaluationDeadline && new Date(project.evaluationDeadline).getTime() < Date.now()) {
      throw new ConflictException({
        error: `评标已超时（截止 ${new Date(project.evaluationDeadline).toISOString()}），请联系采购管理端审批延期后再生成结果`,
        code: 'EVALUATION_OVERDUE',
      });
    }
    if (project.experts.filter(e => e.expertRole === '正选').some(e => !e.reportConfirmed)) {
      throw new BadRequestException({ error: '仍有正选专家未确认评审报告', code: 'EXPERT_REPORTS_NOT_CONFIRMED' });
    }
    // C2: 组长末签闸门
    if (!project.leaderCoSigned) {
      throw new BadRequestException({ error: '评审报告尚未经组长末签', code: 'LEADER_NOT_COSIGNED' });
    }
    // #7: 未裁决的专家异议阻塞结果生成
    const openDisputes = await this.prisma.expertDispute.count({ where: { projectId, status: 'open' } });
    if (openDisputes > 0) {
      throw new BadRequestException({ error: `有 ${openDisputes} 个专家异议待裁决，无法生成评标结果`, code: 'OPEN_DISPUTES' });
    }
    // spec §10：闭环签字包与结果快照一一对应——签字闭环后禁止重生成结果
    // （重生成将使已物理签字的包失去对应对象；如需更正须先走数据修正流程重开签字包）
    const closedPacket = await this.prisma.bidSignPacket.findUnique({
      where: { projectId },
      select: { closedAt: true },
    });
    if (closedPacket?.closedAt) {
      throw new ConflictException({ error: '评标签字已闭环，禁止重生成评标结果；如需更正请走数据修正流程重开签字包', code: 'SIGN_PACKET_CLOSED' });
    }

    // 谈判（negotiation）/多轮类项目：专家评标完成后进行多轮报价，生成结果前校验轮次已完成 + 同步最终报价。
    // P1-13fix：sealed_auction（密封竞价）为单轮唱标模式——唱标价即最终价，无报价轮次流程，
    // 旧口径 if (roundMode) 无差别拦截 → 竞价采购结果生成死锁（NO_ROUNDS）。
    if (project.roundMode && project.roundMode !== 'sealed_auction') {
      const totalRounds = await this.prisma.bidRound.count({ where: { projectId } });
      if (totalRounds === 0) {
        throw new BadRequestException({ error: '本项目为多轮报价项目，请先在开标端(:3007)完成至少一轮报价后再生成结果', code: 'NO_ROUNDS' });
      }
      const unclosedRounds = await this.prisma.bidRound.count({
        where: { projectId, status: { not: 'closed' } },
      });
      if (unclosedRounds > 0) {
        throw new BadRequestException({ error: `还有 ${unclosedRounds} 个报价轮次未结束，请先关闭所有轮次`, code: 'ROUNDS_NOT_CLOSED' });
      }
      // 同步最终轮报价到 BidOpeningRecord（公式引擎从这里读价格）
      await this.bidService.syncMultiRoundPrices(projectId);
    }

    const activeSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED' && s.bidValidity !== 'invalid',
    );

    // 保证金软标记：bondRequired 时查各供应商 bondStatus，异常者写监督日志（不排除，由评标委员会定）
    // A-104：叠加到账台账自动比对（金额/到账/支付形式/台账缺），flagged 项附 reasons 供日志展开
    const bondFlagged: { supplierName: string; bondStatus: string; reasons: string[] }[] = [];
    if (project.bondRequired) {
      const openingRecords = await this.prisma.bidOpeningRecord.findMany({
        where: { projectId },
        select: { bidSupplierId: true, bondStatus: true, supplierName: true },
      });
      const bondBySupplier = new Map(openingRecords.map(r => [r.bidSupplierId, r.bondStatus]));
      const ledgers = await this.prisma.bidBondLedger.findMany({ where: { projectId } });
      const ledgerBySupplier = new Map(ledgers.map(l => [l.supplierName, l]));
      for (const s of activeSuppliers) {
        const status = bondBySupplier.get(s.id);
        const ledger = ledgerBySupplier.get(s.supplierName) ?? null;
        // hasVoucher 不传（undefined → 凭证维跳过）：凭证核验在唱标预填上下文，评标此处无凭证数据
        const reasons = evaluateBondCompliance({
          hasLedger: !!ledger, amount: ledger ? Number(ledger.amount) : null,
          arrivedAt: ledger?.arrivedAt?.toISOString() ?? null, payMethod: ledger?.payMethod ?? null,
          requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
          deadline: project.deadline.toISOString(), bondStatus: status ?? null,
        }).map(i => i.message);
        if (!isBondQualified(status)) {
          bondFlagged.push({ supplierName: s.supplierName, bondStatus: status || '未核对', reasons });
        } else if (reasons.length > 0) {
          // A-104：唱标状态合格但台账比对有出入（金额不足/到账晚/形式不一致/未登记）——同样软标记供审查
          bondFlagged.push({ supplierName: s.supplierName, bondStatus: status!, reasons });
        }
      }
    }

    // P0: Single batch query instead of per-supplier N+1 — fetch all scores at once
    const activeSupplierIds = activeSuppliers.map(s => s.id);
    const allScoreRecords = activeSupplierIds.length > 0
      ? await this.prisma.bidScoreRecord.findMany({
          where: {
            supplierId: { in: activeSupplierIds },
            expert: { projectId, expertRole: '正选' },
          },
        })
      : [];
    // Group records by supplierId for O(1) lookup
    const recordsBySupplier = new Map<string, typeof allScoreRecords>();
    for (const record of allScoreRecords) {
      const arr = recordsBySupplier.get(record.supplierId);
      if (arr) {
        arr.push(record);
      } else {
        recordsBySupplier.set(record.supplierId, [record]);
      }
    }

    // G2: 按供应商聚合 → 每专家对该供应商的总评分 → 专家组≥5 去 1 高 1 低 → 求平均
    const panelSize = project.experts.filter(e => e.expertRole === '正选').length;

    // P1-2：收集完整性警告——正选专家是否都已对活跃供应商完成通过性评分
    const completenessWarnings: { supplierName: string; voters: number; expected: number }[] = [];
    const expectedVoters = project.experts.filter(e => e.expertRole === '正选').length;
    const mainExpertIds = new Set(project.experts.filter(e => e.expertRole === '正选').map(e => e.id));

    // ── 通过性审查废标判定：某项不通过票严格过半 → 该供应商废标 ──
    const passFailVerdicts = new Map<string, boolean>(); // supplierId -> disqualified
    const passFailFailures: { supplierId: string; supplierName: string; category: string; fail: number; total: number }[] = [];
    {
      // 收集所有通过性 scoreItemId（按项目）
      const passFailItemIds = new Set<string>();
      // 需要每个 record 的 scoreItem.category；上面 allScoreRecords 未 include scoreItem，单独查一次通过性项
      const passFailItems = await this.prisma.bidScoreItem.findMany({
        where: { projectId, category: { in: ['QUALIFICATION', 'RESPONSIVE'] } },
        select: { id: true, category: true },
      });
      for (const it of passFailItems) passFailItemIds.add(it.id);
      const categoryById = new Map(passFailItems.map(it => [it.id, it.category as string]));

      // H2: 已撤销的废标（管理员复核 revokeInvalidBid）不计入失败票——否则撤销被本重算静默推翻
      const revokedInvalidBids = await this.prisma.bidInvalidBid.findMany({
        where: { projectId, status: 'revoked' },
        select: { supplierId: true, scoreItemId: true },
      });
      const revokedKeys = new Set(revokedInvalidBids.map(r => `${r.supplierId}:${r.scoreItemId}`));

      for (const supplier of activeSuppliers) {
        const records = recordsBySupplier.get(supplier.id) ?? [];
        let disqualified = false;
        // 逐项统计
        const byItem = new Map<string, { fail: number; total: number }>();
        for (const r of records) {
          if (!mainExpertIds.has(r.expertId)) continue; // 仅正选专家投票计入废标判定
          if (!passFailItemIds.has(r.scoreItemId) || r.passed === null || r.passed === undefined) continue;
          if (revokedKeys.has(`${supplier.id}:${r.scoreItemId}`)) continue; // H2: 已撤销废标不计入失败票
          const agg = byItem.get(r.scoreItemId) ?? { fail: 0, total: 0 };
          agg.total += 1;
          if (r.passed === false) agg.fail += 1;
          byItem.set(r.scoreItemId, agg);
        }
        for (const [itemId, agg] of byItem) {
          if (agg.fail > agg.total - agg.fail) { // 不通过票严格过半
            disqualified = true;
            passFailFailures.push({
              supplierId: supplier.id, supplierName: supplier.supplierName,
              category: categoryById.get(itemId) || '通过性', fail: agg.fail, total: agg.total,
            });
          }
        }
        passFailVerdicts.set(supplier.id, disqualified);

        // P1-2：防御性检查——该供应商是否所有正选专家都已提交通过性评分
        const votersWithPassFail = new Set(
          records.filter(r => passFailItemIds.has(r.scoreItemId) && r.passed !== null && r.passed !== undefined
            && mainExpertIds.has(r.expertId)).map(r => r.expertId),
        );
        if (votersWithPassFail.size < expectedVoters) {
          completenessWarnings.push({
            supplierName: supplier.supplierName,
            voters: votersWithPassFail.size,
            expected: expectedVoters,
          });
        }
      }
    }

    // P1: 价格分公式引擎 — PRICE 类项由公式自动算分,替代专家手填
    const priceItemIds = new Set<string>();
    let formulaPriceScores = new Map<string, number>();
    // A4: 报价从开标记录读取，同时供 createMany 写入 BidEvaluationResult.bidPrice
    const bidPrices = new Map<string, number>();
    {
      const priceItems = await this.prisma.bidScoreItem.findMany({
        where: { projectId, category: 'PRICE' },
        select: { id: true, maxScore: true },
      });
      for (const pi of priceItems) priceItemIds.add(pi.id);

      // 读取唱标报价（无论是否有公式引擎，报价都写入评标结果供定标使用）
      const openingRecs = await this.prisma.bidOpeningRecord.findMany({
        where: { projectId, bidSupplierId: { in: activeSupplierIds } },
        select: { bidSupplierId: true, amount: true },
      });
      for (const r of openingRecs) {
        if (r.amount) {
          const price = parseFloat(String(r.amount).replace(/,/g, ''));
          if (!isNaN(price) && price >= 0) bidPrices.set(r.bidSupplierId!, price);
        }
      }

      // 最高限价：公式引擎与谈判采购超限价判废共用（谈判路径 bidPrices 已含最终轮报价）
      const ceilingPrice = project.ceilingPrice ? Number(project.ceilingPrice) : null;

      if (priceItems.length > 0 && project.priceFormulaConfig) {
        const config = project.priceFormulaConfig as any;
        // F11（2026-08-28）：基准价偏离法/比例法的基准=最高限价——缺失时 calculate 会把全供应商
        // 价格分静默置 0（旧实现仅 warn 后照常生成官方结果，排名全废）。改为 400 拦截并给指引；
        // 「公式配置完全缺失 → 回退专家手填价格分」的设计内行为不受影响（不进本分支），
        // 最低评标价法不依赖限价亦放行。
        if ((config.formulaType === 'benchmark_deviation' || config.formulaType === 'ratio')
            && !(ceilingPrice && ceilingPrice > 0)) {
          throw new BadRequestException({
            error: '价格分公式为基准价偏离法/比例法，但项目未设置最高限价，价格分将无法计算。请先在采购管理工作台（:3005）项目设置中填写最高限价，或将价格分公式改为最低评标价法',
            code: 'CEILING_PRICE_REQUIRED',
          });
        }
        const priceMaxTotal = priceItems.reduce((s, i) => s + Number(i.maxScore), 0);
        formulaPriceScores = this.priceFormula.calculate(config, bidPrices, ceilingPrice, priceMaxTotal);
      }

      // P2-5（2026-09-09 审查）：公式激活时唱标金额缺失/非数值的家，价格分静默按 0 计入
      // （专家 PRICE 打分被跳过且无任何告警）——高风险监督日志提示评标委员会核对开标记录
      // （不阻断生成：记录齐备性由归档闸门保证，此处是数据质量告警）。
      if (priceItems.length > 0 && project.priceFormulaConfig) {
        const missingPrice = activeSuppliers.filter(s => !bidPrices.has(s.id));
        if (missingPrice.length > 0) {
          await this.prisma.bidSupervisionLog.create({
            data: {
              projectId, time: new Date(), role: '系统', target: missingPrice.map(m => m.supplierName).join('、'),
              action: '价格分缺失告警',
              result: '价格分公式已激活但上述供应商唱标金额缺失或非数值，其价格分按 0 计入——请评标委员会核对开标记录',
              riskFlag: '高风险',
            },
          }).catch(() => {});
        }
      }

      // 超限价自动判废：公式引擎项目保持既有口径；谈判采购按最终报价判废
      // （谈判 bidPrices 已由 roundMode 分支的 syncMultiRoundPrices 写入最终轮报价）
      if (ceilingPrice != null
          && ((priceItems.length > 0 && project.priceFormulaConfig)
              || project.procurementMethod === '谈判采购')) {
        const overCeiling = this.priceFormula.getOverCeilingSuppliers(bidPrices, ceilingPrice);
        for (const sid of overCeiling) {
          passFailVerdicts.set(sid, true);
          passFailFailures.push({
            supplierId: sid, supplierName: activeSuppliers.find(s => s.id === sid)?.supplierName ?? sid,
            category: '超限价', fail: 0, total: 0,
          });
        }
      }
    }

    // #16: 异常低价检测（《暂行规定》第二十一条）——低于有效报价均值 70% 写监督日志告警（不自动废标）
    const validPrices = [...bidPrices.values()].filter(p => p > 0);
    if (validPrices.length >= 3) {
      const avgPrice = validPrices.reduce((s, p) => s + p, 0) / validPrices.length;
      for (const [sid, price] of bidPrices) {
        if (price > 0 && price < avgPrice * 0.7) {
          const supName = activeSuppliers.find(s => s.id === sid)?.supplierName ?? sid;
          await this.prisma.bidSupervisionLog.create({
            data: {
              projectId, time: new Date(), role: '系统', target: supName,
              action: '异常低价告警',
              result: `报价 ¥${price} 显著低于有效报价均值 ¥${avgPrice.toFixed(2)}（偏离 ${((1 - price / avgPrice) * 100).toFixed(1)}%），请评标委员会要求该供应商作出书面说明`,
              riskFlag: '高风险',
            },
          }).catch((err) => { this.logger.warn({ msg: '异常低价告警写入监督日志失败', projectId, sid, err: String(err) }); });
        }
      }
    }

    // F12（2026-08-28）：聚合+排序提取为纯函数（bid/aggregate-supplier-scores.ts），与
    // live-official-scores 端点共用——单一事实源，前端预览不再复刻口径。行为与内联版逐行一致。
    const isNegotiation = project.procurementMethod === '谈判采购';
    const ranked = aggregateSupplierScores({
      activeSuppliers,
      recordsBySupplier,
      formulaPriceScores,
      priceItemIds,
      passFailVerdicts,
      bidPrices,
      isNegotiation,
    });

    const qualifiedRanked = ranked.filter(r => !r.disqualified);
    // 按评标办法确定候选人数：最低价类→1, 综合评估→3, 直接采购→1
    const winnerCount = this.getWinnerCount(
      project.procurementMethod,
      project.evaluationMethod ?? null,
      qualifiedRanked.length,
    );

    // #6: EXCEPTION 供应商显式告警——被排除的供应商（解密成功但 confirmStatus=EXCEPTION）
    const excludedExceptionSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'EXCEPTION',
    );

    await this.prisma.$transaction(async (tx) => {
      // #34: FOR UPDATE 行锁——防止并发 generateEvaluationResults 互相覆盖
      await lockAndReassertStage(tx, projectId, 'EVALUATING');
      await tx.bidEvaluationResult.deleteMany({ where: { projectId } });
      // spec §10：结果重生成 → 已有签字包失效（未闭环的包快照将与新结果分叉）。
      // 删除包记录 + 重置全员签字状态，主持人须重新生成签字包（闭环包已被上方闸门挡住）。
      const stalePacket = await tx.bidSignPacket.findUnique({ where: { projectId } });
      if (stalePacket) {
        await tx.bidSignPacket.delete({ where: { projectId } });
        await tx.bidExpert.updateMany({
          where: { projectId, expertRole: '正选' },
          data: {
            signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, signScanFileId: null,
            dissentingOpinion: null, dissentingReason: null,
          },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: project.name,
            action: '评标结果重生成·签字包已失效',
            result: `旧包指纹 ${stalePacket.sha256.slice(0, 16)}… 已作废（快照与结果分叉），须重新生成签字包并重新登记签字`,
            riskFlag: '高',
          },
        });
      }
      if (ranked.length > 0) {
        await tx.bidEvaluationResult.createMany({
          data: ranked.map((r, index) => ({
            projectId,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            totalScore: r.totalScore,
            averageScore: r.averageScore,
            rank: index + 1,
            recommended: !r.disqualified && index < winnerCount,
            disqualified: r.disqualified,
            // A4: 报价从开标记录流入，供定标文件使用
            bidPrice: bidPrices.get(r.supplierId) ?? undefined,
          })),
        });
      }
      // ── 权威重算 bidValidity：覆盖实时触发器可能的多-item race 终态 ──
      // 仅重算 active 供应商（passFailVerdicts 只含 activeSuppliers）。
      // 已被实时触发器判定为 invalid 的非 active 供应商不在 passFailVerdicts 中，
      // 跳过更新以保留其既有 invalid 状态（避免误恢复为 valid）。
      for (const s of project.suppliers) {
        if (passFailVerdicts.has(s.id)) {
          await tx.bidSupplier.update({
            where: { id: s.id },
            data: { bidValidity: passFailVerdicts.get(s.id) ? 'invalid' : 'valid' },
          });
        }
      }

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '生成评标结果', result: `生成${ranked.length}家供应商排名（候选人 ${winnerCount} 名${isNegotiation ? '，谈判采购·最低价中标' : `，专家组 ${panelSize} 人${panelSize >= 5 ? '，去极值' : ''}`}）`, riskFlag: '无',
        },
      });
      for (const f of bondFlagged) {
        // 措辞按分支：状态不合格=「未达标」；A-104 第三分支（状态合格但台账比对有出入）不得误标未达标
        const verdict = isBondQualified(f.bondStatus) ? '台账比对有出入，供评标委员会审查' : '未达标，供评标委员会审查';
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: f.supplierName,
            action: '保证金异常标记', result: `保证金状态：${f.bondStatus}（${verdict}${f.reasons?.length ? `；台账比对：${f.reasons.join('；')}` : ''}）`, riskFlag: '高风险',
          },
        });
      }
      for (const f of passFailFailures) {
        const result = f.category === '超限价'
          ? '最终报价超过最高限价，依据采购文件规定予以废标'
          : `经评审委员会表决，${f.category === 'QUALIFICATION' ? '资格' : '响应性'}审查不通过（不通过 ${f.fail}/${f.total} 票），依据招标文件规定予以废标`;
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '评标委员会', target: f.supplierName,
            action: '废标决议', result, riskFlag: '高风险',
          },
        });
      }
      // P1-3：专家组人数不足时写入监督日志
      if (panelSize < 3) {
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: project.name,
            action: '评标专家组人数不足',
            result: `专家组仅 ${panelSize} 人（不足 3 人），统计意义有限`, riskFlag: '中' },
        });
      }
      // P1-2：通过性评分完整性警告
      for (const w of completenessWarnings) {
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: w.supplierName,
            action: '废标表决完整性警告',
            result: `仅 ${w.voters}/${w.expected} 位正选专家完成通过性审查`, riskFlag: '高' },
        });
      }
    });
    // 评标完整性快照（生成结果后、归档前的独立证据包）
    try {
      const pkg = await this.buildEvaluationPackage(projectId);
      const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
      const objectKey = `bid-evaluation-handover/${projectId}.json`;
      await this.storage.upload(objectKey, buffer, 'application/json');
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      // N3：结果重生成 = 同 key 覆盖 MinIO；create 会撞 key @unique（P2002）且被下方 catch 吞掉，
      // 造成 DB 仍留旧指纹、与 MinIO 新内容分叉。改 upsert：同 key 更新行（P1-17 同款）。
      const existingSnapshot = await this.prisma.fileAsset.findUnique({
        where: { key: objectKey }, select: { id: true },
      });
      await this.prisma.fileAsset.upsert({
        where: { key: objectKey },
        create: {
          key: objectKey,
          originalName: `评标包-${project.projectCode}.json`,
          mimeType: 'application/json',
          size: buffer.length,
          sha256,
          category: 'bid_evaluation_handover',
          uploaderId: actorId ?? null,
        },
        update: { size: buffer.length, sha256, uploaderId: actorId ?? null },
      });
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统', target: project.name,
          action: '评标完整性快照',
          result: `${existingSnapshot ? '已更新（结果重生成，覆盖旧指纹）' : '指纹'} ${sha256.slice(0, 16)}…`,
          riskFlag: '无',
        },
      }).catch(() => {});
    } catch (e) {
      this.logger.error('评标快照生成失败（不阻塞结果生成）', e instanceof Error ? e.message : String(e));
    }
    this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '生成评标结果', target: project.name, result: `生成${ranked.length}家供应商排名（候选人 ${winnerCount} 名${isNegotiation ? '，谈判采购·最低价中标' : `，专家组 ${panelSize} 人${panelSize >= 5 ? '，去极值' : ''}`}）`, riskFlag: '无' });
    if (actorId) await this.prisma.auditLog.create({ data: { userId: actorId, action: 'BID_RESULTS_GENERATED', resourceType: `BidProject:${projectId}`, details: { rankedCount: ranked.length } } });

    // #6: 返回值统一为 { results, excludedSuppliers? }。
    // 历史形状是裸数组 + 有排除时 {...数组} 摊成对象，前端 setResults(r) 后
    // r.length/r.find 形状不稳定（有排除供应商时直接崩溃）。2026-08-28 统一包一层。
    const results = await this.listEvaluationResults(projectId);
    return {
      results,
      ...(excludedExceptionSuppliers.length > 0
        ? { excludedSuppliers: excludedExceptionSuppliers.map(s => ({ supplierId: s.id, supplierName: s.supplierName, reason: '开标确认状态为异常(EXCEPTION)，未纳入排名' })) }
        : {}),
    };
  }
}
