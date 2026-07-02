import {
  Controller,
  Get,
  Param,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenderHistoryService } from './tender-history.service';
import {
  CreateTenderHistoryDto,
  QueryTenderHistoryDto,
} from './dto/tender-history.dto';

@UseGuards(AuthGuard)
@Controller('tender-history')
export class TenderHistoryController {
  constructor(private readonly tenderHistoryService: TenderHistoryService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTenderHistoryDto,
  ) {
    return this.tenderHistoryService.create(dto, user);
  }

  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTenderHistoryDto,
  ) {
    return this.tenderHistoryService.findMany(query, user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tenderHistoryService.findOne(id, user);
  }

  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tenderHistoryService.delete(id, user);
  }
}
