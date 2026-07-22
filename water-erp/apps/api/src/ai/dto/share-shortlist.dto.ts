import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ArrayMaxSize, MaxLength, ValidateNested } from 'class-validator';

/** #17 分享候选名单入参校验——此前为内联类型，全局 ValidationPipe 对其无效，shortlist[].name 无上限。 */
export class ShareShortlistItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsNumber()
  matchScore: number;

  @IsString() @IsOptional() @MaxLength(500)
  reason?: string;
}

export class ShareShortlistDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  requirement: string;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ShareShortlistItemDto)
  shortlist: ShareShortlistItemDto[];

  @IsString() @IsOptional() @MaxLength(500)
  note?: string;
}
