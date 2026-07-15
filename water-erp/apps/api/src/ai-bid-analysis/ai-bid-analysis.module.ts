// apps/api/src/ai-bid-analysis/ai-bid-analysis.module.ts
// AI 投标文件分析模块（per-item 版，Phase 4 装配）
// PrismaModule / LocalAiModule(LlmService,OcrService) / StorageModule 均 @Global，无需 import
import { Module } from '@nestjs/common';

// 复制自 procurement 的 services（已 per-item 适配）
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

// per-item 核心新服务（Phase 3.2）
import { ConcordanceVerifierService } from './services/concordance-verifier.service';
import { SystemDataAggregatorService } from './services/system-data-aggregator.service';
import { GenericItemScorerService } from './services/generic-item-scorer.service';
import { ScoreCriteriaInfererService } from './services/score-criteria-inferer.service';
import { PlaintextFetcherService } from './services/plaintext-fetcher.service';
import { RequirementMatcherService } from './services/requirement-matcher.service';

const SERVICES = [
  // 复制适配的 services
  ReportGeneratorService,
  ComparativeScoringService,
  FraudDetectorService,
  CompetitiveAnalysisService,
  DocxGeneratorService,
  BidderExtractorService,
  TenderExtractorService,
  DocumentMetadataExtractorService,
  CacheService,
  PriceAnalyzerService, // 方案2：被 GenericItemScorer 复用（价格 LLM 分析层）
  // per-item 核心新服务
  ConcordanceVerifierService,
  SystemDataAggregatorService,
  GenericItemScorerService,
  ScoreCriteriaInfererService,
  PlaintextFetcherService,
  RequirementMatcherService, // Task 7：条款-响应定位（写入 bidderResult.requirementResponses）
];

@Module({
  providers: SERVICES,
  exports: SERVICES,
})
export class AiBidAnalysisModule {}
