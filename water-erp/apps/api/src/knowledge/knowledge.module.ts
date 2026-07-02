import { Module } from '@nestjs/common';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { DocumentParserService } from './services/document-parser.service';
import { TextSplitterService } from './services/text-splitter.service';
import { VectorSearchService } from './services/vector-search.service';
import { VectorInitService } from './services/vector-init.service';

@Module({
  imports: [LocalAiModule, AuthModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    DocumentParserService,
    TextSplitterService,
    VectorSearchService,
    VectorInitService,
  ],
  exports: [
    KnowledgeService,
    VectorSearchService,
    DocumentParserService,
    TextSplitterService,
  ],
})
export class KnowledgeModule {}
