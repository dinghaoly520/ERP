import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenderClarificationService } from './tender-clarification.service';
import { AnswerClarificationDto } from './dto/answer-clarification.dto';

/** W1 澄清工作台（:3005）：问答答复 / 版本化澄清文件（Task 5 起补） */
@Controller('tender-clarification')
@Roles('staff', 'leader', 'admin')
export class TenderClarificationController {
  constructor(private readonly svc: TenderClarificationService) {}

  /** A-81：管理端澄清工作台数据 */
  @Get('projects/:id')
  list(@Param('id') id: string) {
    return this.svc.listForStaff(id);
  }

  /** A-81：答复澄清问题 */
  @Post('projects/:id/questions/:qid/answer')
  answer(
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Body() dto: AnswerClarificationDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.svc.answer(id, qid, dto.answer, userId);
  }
}
