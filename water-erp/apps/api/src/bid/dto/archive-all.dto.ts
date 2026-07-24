import { IsIn, IsOptional } from 'class-validator';

/**
 * 一键归档入参。
 * scope='opening'：开标归档（仅开标文件 5 项，不要求评标结果，流标/废标场景）；
 * scope='full'（默认）：完整归档（含评分明细/评标结果，要求评标结果已生成）。
 * 两者均为终局操作（ARCHIVED 不可逆）。
 */
export class ArchiveAllDto {
  @IsOptional()
  @IsIn(['opening', 'full'])
  scope?: 'opening' | 'full';
}
