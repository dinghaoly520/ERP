import { Module, forwardRef } from '@nestjs/common';
import { PrequalController } from './prequal.controller';
import { PrequalService } from './prequal.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    forwardRef(() => NotificationModule),PrismaModule, StorageModule],
  controllers: [PrequalController],
  providers: [PrequalService],
  exports: [PrequalService],
})
export class PrequalModule {}
