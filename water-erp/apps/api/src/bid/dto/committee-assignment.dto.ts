import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CommitteeAssignmentItemDto {
  @IsString() @MaxLength(64) userId!: string;
  /** A-132 评审分组；null=清除（显式置空），undefined=不动 */
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsIn(['技术组', '商务组', '综合组'])
  reviewGroup?: string | null;
  /** A-132 组内职责；null=清除，undefined=不动 */
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsIn(['主审', '复核', '成员'])
  dutyRole?: string | null;
}
export class CommitteeAssignmentDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => CommitteeAssignmentItemDto)
  assignments!: CommitteeAssignmentItemDto[];
}
