import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** 标记正式盖章版采购文件（2026-09-26）：指针即真相——用户标记哪个附件是正式文件就认哪个，
 *  不限类型（扫描 PDF / 图片 / 盖章 docx 皆可）。03 完成强制闸（OFFICIAL_TENDER_REQUIRED）读此指针。 */
export class SelectOfficialTenderDto {
  @IsString()
  attachmentId!: string;

  /** 目标阶段行轮次（同 UpdateProjectStageDto.round 契约：缺省取 PMI.currentRound） */
  @IsInt()
  @Min(1)
  @IsOptional()
  round?: number;
}
