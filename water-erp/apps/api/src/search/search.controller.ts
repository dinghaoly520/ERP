import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { SearchService } from './search.service';

@ApiTags('全局搜索')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '全局搜索（供应商/项目/专家/采购）' })
  async search(@Query('q') q: string) {
    return this.searchService.search(q);
  }
}
