import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateProjectStageDto {
  @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
  status!: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

  @IsString()
  @IsOptional()
  note?: string;

  /** M5 豁免开关：确无该阶段必选归档材料（流标终止/框架协议无单件合同等）时显式豁免，
   *  要求 note 填写豁免理由留痕（DA/T 103-2024 §6 允许各单位结合实际编制归档范围）。 */
  @IsBoolean()
  @IsOptional()
  waiveArchiveGate?: boolean;

  /** 供应商邀请阶段完成门槛：确认参加的回执数量达到该值即可标记完成（默认 3，1~50）。
   *  达标即放行，替代"须先发送邀请通知"的单一核查。 */
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  confirmedThreshold?: number;
}
