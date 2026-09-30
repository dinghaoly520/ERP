import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 重开专家评审确认（受控数据更正）：解锁 reportConfirmed 后专家可改分，
 * 评分历史完整保留（改分走 BidScoreRecordHistory），须重新确认报告后方可重新生成结果。
 * 仅评标阶段可重开；签字包已闭环须先走签字包重开（admin）。
 * expertId 缺省=全部已确认正选。
 */
export class ReopenExpertScoringDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsString()
  expertId?: string;
}
