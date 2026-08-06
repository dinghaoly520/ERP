import { IsArray, IsString } from 'class-validator';

/**
 * Phase 1：得分点↔招标条款映射（独立于发布锁，因 linkedRequirementIds 仅为指引元数据，
 * 不参与评分计算；管理端即便评分标准已发布、专家已开始打分，仍可维护映射）。
 */
export class UpdateLinkedRequirementsDto {
  @IsArray()
  @IsString({ each: true })
  linkedRequirementIds: string[];
}
