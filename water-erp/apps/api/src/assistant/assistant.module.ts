import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BidModule } from '../bid/bid.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { DeepSeekProvider } from './model/deepseek.provider';
import { ToolRegistry } from './tools/tool-registry';
import { GlobalOverviewTool } from './tools/global-overview.tool';
import { ProcurementTool } from './tools/procurement.tool';
import { BidTool } from './tools/bid.tool';
import { SupplierTool } from './tools/supplier.tool';
import { ExpertTool } from './tools/expert.tool';
import { AnnouncementTool } from './tools/announcement.tool';
import { NotificationTool } from './tools/notification.tool';
import { MallTool } from './tools/mall.tool';
import { ActionPlannerService } from './actions/action-planner.service';
import { ActionExecutorService } from './actions/action-executor.service';

@Module({
  imports: [PrismaModule, BidModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    DeepSeekProvider,
    ToolRegistry,
    GlobalOverviewTool,
    ProcurementTool,
    BidTool,
    SupplierTool,
    ExpertTool,
    AnnouncementTool,
    NotificationTool,
    MallTool,
    ActionPlannerService,
    ActionExecutorService,
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
