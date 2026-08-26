import { Module } from '@nestjs/common';
import { FrameworkController } from './framework.controller';
import { FrameworkService } from './framework.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [FrameworkController],
  providers: [FrameworkService],
  exports: [FrameworkService],
})
export class FrameworkModule {}
