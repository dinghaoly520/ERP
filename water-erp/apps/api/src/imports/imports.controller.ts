import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ImportsService } from './imports.service';
import { Roles } from '../common/decorators/roles.decorator';

class ImportFromPathDto {
  @IsString()
  filePath!: string;
}

@Controller('imports')
@Roles('leader', 'admin', 'staff')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('bootstrap')
  bootstrapFromWorkbook() {
    return this.importsService.importWorkbookFromDefaultFile();
  }

  @Post('from-path')
  importFromPath(@Body() dto: ImportFromPathDto) {
    return this.importsService.importWorkbookFromPath(dto.filePath);
  }
}
