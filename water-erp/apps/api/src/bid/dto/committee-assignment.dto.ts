import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CommitteeAssignmentItemDto {
  @IsString() @MaxLength(64) userId!: string;
  @IsOptional() @IsIn(['技术组', '商务组', '综合组']) reviewGroup?: string;
  @IsOptional() @IsIn(['主审', '复核', '成员']) dutyRole?: string;
}
export class CommitteeAssignmentDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => CommitteeAssignmentItemDto)
  assignments!: CommitteeAssignmentItemDto[];
}
