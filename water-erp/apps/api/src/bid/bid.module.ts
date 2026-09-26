import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkTemplateController } from './work-template.controller';
import { WorkTemplateService } from './work-template.service';
import { OpeningSignController } from './opening-sign.controller';
import { OpeningSignService } from './opening-sign.service';
import { AdminCertController } from './admin-cert.controller';
import { BidController } from './bid.controller';
import { NonTenderDealController } from './non-tender-deal.controller';
import { NonTenderDealService } from './non-tender-deal.service';
import { BidService } from './bid.service';
import { BidBondService } from './bid-bond.service';
import { BidEvaluationResultsService } from './bid-evaluation-results.service';
import { BidOpeningRecordService } from './bid-opening-record.service';
import { BidDecryptService } from './bid-decrypt.service';
import { BondLedgerService } from './bond-ledger.service';
import { GbCodeService } from '../common/gb-code.service';
import { BidScoreStandardService } from './bid-score-standard.service';
import { BidSignPacketController } from './bid-sign-packet.controller';
import { BidSignPacketService } from './bid-sign-packet.service';
import { BidSignPacketDocxService } from './bid-sign-packet-docx.service';
import { BidGateway } from './bid.gateway';
import { ClarificationAiService } from './clarification-ai.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { ScorePointExtractorService } from './score-point-extractor.service';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { PriceFormulaService } from './price-formula.service';
import { BidBackupModule } from '../bid-backup/bid-backup.module';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { SignatureService } from '../common/crypto/signature.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TENDER_PROCESSING },
      { name: QUEUE_NAMES.BIDDER_PROCESSING }, // 单家重试 AI 分析（retryAiBidders）
    ),
    // AiBidAnalysisModule 已撤（2026-09-26）：原为 ScorePointExtractor 注入 PlaintextFetcherService
    // （公告链提取源）；公告链已删、提取只认 PMI 03 阶段附件，bid 模块对 ai-bid-analysis 仅剩
    // 常量/纯函数 import（QUEUE_NAMES/prompts/file-processor），无需模块级依赖
    BidBackupModule,
  ],
  controllers: [BidController, BidSignPacketController, AdminCertController, NonTenderDealController, OpeningSignController, WorkTemplateController],
  providers: [
    GbCodeService, NonTenderDealService, WorkTemplateService, BidService, BidEvaluationResultsService, BidOpeningRecordService, BidDecryptService, BidBondService, BondLedgerService, BidScoreStandardService, BidGateway, ClarificationAiService, ScorePointExtractorService, ScoreStandardValidator, PriceFormulaService, BidSignPacketService, BidSignPacketDocxService, AdminKeyService, SignatureService, DualEnvelopeService, OpeningSignService],
  exports: [BidGateway, BidService, ClarificationAiService, AdminKeyService, DualEnvelopeService, BidSignPacketService, ScoreStandardValidator],
})
export class BidModule implements OnModuleInit {
  private readonly logger = new Logger(BidModule.name);
  constructor(private readonly adminKey: AdminKeyService) {}

  /** 管理方加密证书 bootstrap：无 active 证书时自动生成（幂等）。
   *  失败不阻塞启动——DB/文件系统暂不可用时 warn 放行，首次实际使用前可重试（ensureBootstrap 幂等）。 */
  async onModuleInit(): Promise<void> {
    try {
      await this.adminKey.ensureBootstrap();
    } catch (e) {
      this.logger.warn(`管理方加密证书 bootstrap 失败（不阻塞启动）：${(e as Error).message}`);
    }
  }
}
