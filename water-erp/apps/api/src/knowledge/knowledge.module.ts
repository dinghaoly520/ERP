import { Module } from '@nestjs/common';
import { LocalAiModule } from '../local-ai/local-ai.module';
import { KnowledgeQueueModule } from './queues/knowledge-queue.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { DocumentParserService } from './services/document-parser.service';
import { TextSplitterService } from './services/text-splitter.service';
import { VectorSearchService } from './services/vector-search.service';
import { VectorInitService } from './services/vector-init.service';
import { VectorDbService } from './services/vector-db.service';

// AuthModule 已摘（2026-11-06）：模块内仅 type-only 引用与 @CurrentUser 纯参数装饰器，
// 无 provider 注入；且 worker 进程引 KnowledgeModule 时会拖进 AuthModule→NotificationModule
//（WS 网关）在无 HTTP 上下文中实例化。API 侧鉴权由全局 APP_GUARD（AppModule）承担，不受影响。
@Module({
  imports: [LocalAiModule, KnowledgeQueueModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    DocumentParserService,
    TextSplitterService,
    VectorSearchService,
    VectorInitService,
    VectorDbService,
  ],
  exports: [
    KnowledgeService,
    VectorSearchService,
    DocumentParserService,
    TextSplitterService,
  ],
})
export class KnowledgeModule {}
