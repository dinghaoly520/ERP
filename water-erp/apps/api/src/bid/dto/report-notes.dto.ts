import { IsArray, IsIn, IsString, IsOptional, ArrayMinSize, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** A-151：评标报告章节附注白名单（《暂行规定》第四十二条十项 = 主报告十节）——DTO 与 service 硬校验共用单一来源 */
export const REPORT_NOTE_SECTIONS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

export class ReportNoteItemDto {
  @IsIn(REPORT_NOTE_SECTIONS) section!: string;
  @IsString() @MaxLength(2000) content!: string;
}
export class ReportNotesDto {
  @IsOptional() @IsArray() @ArrayMinSize(0) @ValidateNested({ each: true })
  @Type(() => ReportNoteItemDto)
  notes!: ReportNoteItemDto[];
}
