import { IsIn, IsOptional, IsString } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class QueryProjectManagementDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  requesterDepartment?: string;

  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED', 'RECYCLED', 'TERMINATED'])
  status?: 'ACTIVE' | 'ARCHIVED' | 'RECYCLED' | 'TERMINATED';

  @IsOptional()
  @IsString()
  currentStage?: string;

  /** admin 专用公司过滤（公司级数据隔离）：不传/'all' = 全部公司；非 admin 一律忽略
   *  （staff 保持个人隔离；leader 强制本人公司视野，见 service.list 2026-10-10 修订） */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** 仅本人创建的项目（2026-11-06 用户裁定：公告关联项目只能选自己的）——
   *  覆盖 leader/admin 的公司/全量视野；消费方：notice/new 关联项目选择器 */
  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}
