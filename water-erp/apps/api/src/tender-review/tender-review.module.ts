import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { AuthModule } from '../auth/auth.module';
import { TenderReviewController } from './tender-review.controller';
import { ClauseParserService } from './services/clause-parser.service';
import { RuleExtractorService } from './services/rule-extractor.service';
import { FieldExtractorService } from './services/field-extractor.service';
import { RuleExecutorService } from './services/rule-executor.service';
import { SemanticReviewerService } from './services/semantic-reviewer.service';
import { GeneralReviewerService } from './services/general-reviewer.service';
import { LlmFreeReviewerService } from './services/llm-free-reviewer.service';
import { ReportGeneratorService } from './services/report-generator.service';

@Module({
  imports: [KnowledgeModule, LocalAiModule, AuthModule],
  controllers: [TenderReviewController],
  providers: [
    ClauseParserService,
    RuleExtractorService,
    FieldExtractorService,
    RuleExecutorService,
    SemanticReviewerService,
    GeneralReviewerService,
    LlmFreeReviewerService,
    ReportGeneratorService,
  ],
})
export class TenderReviewModule {}
