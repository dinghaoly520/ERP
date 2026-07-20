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
import { TenderSampleService } from './tender-sample.service';
import {
  CreateTenderFieldSampleDto,
  UpdateTenderFieldSampleDto,
  QueryTenderFieldSampleDto,
} from './dto/tender-field-sample.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tender-sample')
@Roles('procurement_staff', 'leader', 'admin', 'staff')
export class TenderSampleController {
  constructor(private readonly tenderSampleService: TenderSampleService) {}

  @Post()
  create(@Body() dto: CreateTenderFieldSampleDto) {
    return this.tenderSampleService.create(dto);
  }

  @Get()
  findByFieldKey(@Query() dto: QueryTenderFieldSampleDto) {
    return this.tenderSampleService.findByFieldKey(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenderFieldSampleDto) {
    return this.tenderSampleService.update(id, dto);
  }

  @Patch(':id/toggle-favorite')
  toggleFavorite(@Param('id') id: string) {
    return this.tenderSampleService.toggleFavorite(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tenderSampleService.remove(id);
  }
}
