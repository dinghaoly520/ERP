import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectPlanController } from './project-plan.controller';
import { ProjectPlanService } from './project-plan.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectPlanController],
  providers: [ProjectPlanService],
  exports: [ProjectPlanService],
})
export class ProjectPlanModule {}
