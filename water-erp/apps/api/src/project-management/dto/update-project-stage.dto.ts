import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class UpdateProjectStageDto {
  @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
  status!: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

  /** 直接采购 03（谈判文件）完成确认值（2026-11-18 用户裁定）：随完成调用一并落库——
   *  综合分析确认弹窗的最终值（用户可改）；采购文件获取时间固定写"/"（服务端写死）。 */
  @EmptyAsUndefined()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  directOverview?: string;

  @EmptyAsUndefined()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  directOpeningTime?: string;

  /** 目标阶段行轮次（多轮再次采购每轮各有一行同 stageKey 阶段——schema (pmiId, stageKey, round)
   *  唯一）。缺省取 PMI.currentRound；不带 round 的解析在多轮项目会命中任意行（I-1 修复）。 */
  @EmptyAsUndefined()
  @IsInt()
  @Min(1)
  @IsOptional()
  round?: number;

  @IsString()
  @IsOptional()
  note?: string;

  /** M5 豁免开关：确无该阶段必选归档材料（流标终止/框架协议无单件合同等）时显式豁免，
   *  要求 note 填写豁免理由留痕（DA/T 103-2024 §6 允许各单位结合实际编制归档范围）。 */
  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  waiveArchiveGate?: boolean;

  /** 供应商邀请阶段完成门槛：确认参加的回执数量达到该值即可标记完成（默认 3，1~50）。
   *  达标即放行，替代"须先发送邀请通知"的单一核查。 */
  @EmptyAsUndefined()
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  confirmedThreshold?: number;
}
