import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWorkArrangementDto } from './dto/create-work-arrangement.dto';
import { CreateWorkArrangementNoteDto } from './dto/create-work-arrangement-note.dto';
import { CreateWorkArrangementTemplateDto } from './dto/create-work-arrangement-template.dto';
import { QueryWorkArrangementsDto } from './dto/query-work-arrangements.dto';
import { PostponeWorkArrangementReminderDto } from './dto/postpone-work-arrangement-reminder.dto';
import { UpdateWorkArrangementDto } from './dto/update-work-arrangement.dto';
import { UpdateWorkArrangementTemplateDto } from './dto/update-work-arrangement-template.dto';
import { WorkArrangementsService } from './work-arrangements.service';

@Controller('work-arrangements')
@Roles('admin', 'leader', 'staff')
export class WorkArrangementsController {
  constructor(
    private readonly workArrangementsService: WorkArrangementsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryWorkArrangementsDto,
  ) {
    return this.workArrangementsService.list(user.sub, query);
  }

  @Get('admin/all')
  @Roles('admin')
  listAll() {
    return this.workArrangementsService.listAll();
  }

  @Get('daily-plan')
  dailyPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.workArrangementsService.buildDailyPlan(user.sub, date);
  }

  @Post('daily-plan/refresh')
  async refreshDailyPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.workArrangementsService.regenerateDailyPlan(user.sub, date);
  }

  @Post('daily-plan/refresh-all')
  @Roles('admin')
  async refreshAllDailyPlans() {
    return this.workArrangementsService.refreshDailyGreeting();
  }

  @Get('greeting')
  greeting(@CurrentUser() user: AuthenticatedUser) {
    return this.workArrangementsService.generateGreeting(
      user.sub,
      user.username,
    );
  }

  @Get('portrait')
  portrait(@CurrentUser() user: AuthenticatedUser) {
    return this.workArrangementsService.buildPortrait(user.sub);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.workArrangementsService.buildWorkbenchSummary(user.sub, date);
  }

  @Get('templates')
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.workArrangementsService.listTemplates(user.sub);
  }

  @Post('templates')
  createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkArrangementTemplateDto,
  ) {
    return this.workArrangementsService.createTemplate(user.sub, dto);
  }

  @Patch('templates/:id')
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkArrangementTemplateDto,
  ) {
    return this.workArrangementsService.updateTemplate(user.sub, id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.workArrangementsService.deleteTemplate(user.sub, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkArrangementDto,
  ) {
    return this.workArrangementsService.create(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkArrangementDto,
  ) {
    return this.workArrangementsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workArrangementsService.delete(user.sub, id);
  }

  @Post(':id/postpone-reminder')
  postponeReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PostponeWorkArrangementReminderDto,
  ) {
    return this.workArrangementsService.postponeReminder(user.sub, id, dto);
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateWorkArrangementNoteDto,
  ) {
    return this.workArrangementsService.addNote(user.sub, id, dto);
  }
}
