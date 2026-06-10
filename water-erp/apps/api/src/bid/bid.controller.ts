import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { BidService } from './bid.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';

@Controller('bid')
@UseGuards(AuthGuard)
export class BidController {
  constructor(private bidService: BidService) {}

  @Get('projects')
  listProjects() { return this.bidService.listProjects(); }

  @Post('projects')
  createProject(@Body() dto: CreateBidProjectDto) { return this.bidService.createProject(dto); }

  @Get('projects/:id')
  getProject(@Param('id') id: string) { return this.bidService.getProject(id); }

  @Patch('projects/:id')
  updateProject(@Param('id') id: string, @Body() dto: UpdateBidProjectDto) { return this.bidService.updateProject(id, dto); }

  @Get('projects/:id/suppliers')
  listSuppliers(@Param('id') id: string) { return this.bidService.listSuppliers(id); }

  @Post('projects/:id/suppliers')
  submitBid(@Param('id') id: string, @Body() dto: SubmitBidDto) { return this.bidService.submitBid(id, dto); }

  @Post('projects/:id/open')
  startOpening(@Param('id') id: string) { return this.bidService.startOpening(id); }

  @Post('projects/:id/decrypt/:supplierId')
  decryptSupplier(@Param('id') id: string, @Param('supplierId') supplierId: string) { return this.bidService.decryptSupplier(id, supplierId); }

  @Get('projects/:id/opening-records')
  listOpeningRecords(@Param('id') id: string) { return this.bidService.listOpeningRecords(id); }

  @Get('projects/:id/experts')
  listExperts(@Param('id') id: string) { return this.bidService.listExperts(id); }

  @Post('projects/:id/scores')
  submitScore(@Param('id') id: string, @Body() dto: CreateScoreDto) { return this.bidService.submitScore(id, dto); }

  @Get('projects/:id/scores')
  listScores(@Param('id') id: string) { return this.bidService.listScores(id); }

  @Get('projects/:id/clarifications')
  listClarifications(@Param('id') id: string) { return this.bidService.listClarifications(id); }

  @Post('projects/:id/clarifications')
  createClarification(@Param('id') id: string, @Body() dto: CreateClarificationDto) { return this.bidService.createClarification(id, dto); }

  @Get('projects/:id/supervision-logs')
  listSupervisionLogs(@Param('id') id: string) { return this.bidService.listSupervisionLogs(id); }

  @Get('projects/:id/archives')
  listArchives(@Param('id') id: string) { return this.bidService.listArchives(id); }

  @Post('projects/:id/archive-all')
  archiveAll(@Param('id') id: string) { return this.bidService.archiveAll(id); }
}
