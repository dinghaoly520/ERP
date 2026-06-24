// apps/api/src/ai-bid-analysis/ai-bid-analysis.module.ts
// AI 投标文件分析模块（per-item 版，Phase 4 装配）
// PrismaModule / LocalAiModule(LlmService,OcrService) / StorageModule 均 @Global，无需 import
import { Module } from '@nestjs/common';

// 复制自 procurement 的 services（已 per-item 适配）
import { TaskService } from './services/task.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { ComparativeScoringService } from './services/comparative-scoring.service';
import { FraudDetectorService } from './services/fraud-detector.service';
import { CompetitiveAnalysisService } from './services/competitive-analysis.service';
import { DocxGeneratorService } from './services/docx-generator.service';
import { BidderExtractorService } from './services/bidder-extractor.service';
import { TenderExtractorService } from './services/tender-extractor.service';
import { DocumentMetadataExtractorService } from './services/document-metadata-extractor.service';
import { CacheService } from './services/cache.service';
import { PriceAnalyzerService } from './services/price-analyzer.service';
import { CommercialScorerService } from './services/commercial-scorer.service';
import { TechnicalScorerService } from './services/technical-scorer.service';

// per-item 核心新服务（Phase 3.2）
import { ConcordanceVerifierService } from './services/concordance-verifier.service';
import { SystemDataAggregatorService } from './services/system-data-aggregator.service';
import { GenericItemScorerService } from './services/generic-item-scorer.service';
import { ScoreCriteriaInfererService } from './services/score-criteria-inferer.service';
import { PlaintextFetcherService } from './services/plaintext-fetcher.service';

const SERVICES = [
  // 复制适配的 services
  TaskService,
  ReportGeneratorService,
  ComparativeScoringService,
  FraudDetectorService,
  CompetitiveAnalysisService,
  DocxGeneratorService,
  BidderExtractorService,
  TenderExtractorService,
  DocumentMetadataExtractorService,
  CacheService,
  PriceAnalyzerService,
  CommercialScorerService,
  TechnicalScorerService,
  // per-item 新服务（注：TechnicalScorer/CommercialScorer/PriceAnalyzer 已被 GenericItemScorer 取代，
  // 暂保留 provider 以兼容现有代码引用，后续清理）
  ConcordanceVerifierService,
  SystemDataAggregatorService,
  GenericItemScorerService,
  ScoreCriteriaInfererService,
  PlaintextFetcherService,
];

@Module({
  providers: SERVICES,
  exports: SERVICES,
})
export class AiBidAnalysisModule {}
