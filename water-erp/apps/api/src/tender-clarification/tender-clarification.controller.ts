import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenderClarificationService } from './tender-clarification.service';
import { AnswerClarificationDto } from './dto/answer-clarification.dto';
import { CreateClarificationDocDto } from './dto/create-clarification-doc.dto';

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

  /** A-82/A-83：新建澄清文件（草稿，版本自增） */
  @Post('projects/:id/docs')
  createDoc(@Param('id') id: string, @Body() dto: CreateClarificationDocDto, @CurrentUser('sub') userId: string) {
    return this.svc.createDoc(id, dto, userId);
  }

  /** A-82：发布澄清文件（B-012 窗口 + Task 6 通知/公告联动） */
  @Post('projects/:id/docs/:docId/publish')
  async publishDoc(@Param('id') id: string, @Param('docId') docId: string, @CurrentUser('sub') userId: string) {
    const stamp = await this.svc.userCompany(userId);
    return this.svc.publishDoc(id, docId, userId, stamp);
  }

  /** A-82：修改草稿（已发布锁定） */
  @Patch('projects/:id/docs/:docId')
  updateDoc(@Param('id') id: string, @Param('docId') docId: string, @Body() dto: CreateClarificationDocDto) {
    return this.svc.updateDoc(id, docId, dto);
  }

  /** A-82：删除草稿（已发布锁定） */
  @Delete('projects/:id/docs/:docId')
  deleteDoc(@Param('id') id: string, @Param('docId') docId: string) {
    return this.svc.deleteDoc(id, docId);
  }
}
