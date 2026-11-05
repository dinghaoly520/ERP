import { Module } from '@nestjs/common';
import { FrameworkService } from './framework.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [FrameworkService],
  exports: [FrameworkService],
})
export class FrameworkModule {}
