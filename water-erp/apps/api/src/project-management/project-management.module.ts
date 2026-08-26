import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ArchiveModule } from '../archive/archive.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProjectManagementController } from './project-management.controller';
import { ProjectManagementService } from './project-management.service';
import { GbCodeService } from '../common/gb-code.service';

@Module({
  imports: [AiModule, AuthModule, KnowledgeModule, PrismaModule, StorageModule, ArchiveModule],
  controllers: [ProjectManagementController],
  providers: [
    GbCodeService,ProjectManagementService],
  exports: [ProjectManagementService],
})
export class ProjectManagementModule {}
