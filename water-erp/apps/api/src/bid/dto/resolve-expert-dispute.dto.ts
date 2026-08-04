import { IsString, IsNotEmpty, IsIn } from 'class-validator';

/** 采购端裁决专家异议工单：status=resolved 采纳，rejected 驳回。 */
export class ResolveExpertDisputeDto {
  @IsString()
  @IsNotEmpty()
  response: string;

  @IsIn(['resolved', 'rejected'])
  status: string;
}
