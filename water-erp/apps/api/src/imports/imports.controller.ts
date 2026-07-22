import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ImportsService } from './imports.service';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';

class ImportFromPathDto {
  @IsString()
  filePath!: string;
}

@Controller('imports')
@UseGuards(AuthGuard)
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
