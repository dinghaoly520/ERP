import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class TerminateProjectDto {
  @IsString()
  @IsNotEmpty({ message: '请填写终止原因。' })
  @MinLength(2, { message: '终止原因至少 2 个字符。' })
  @MaxLength(1000)
  reason!: string;

  /** 终止通知对象（2026-09-20 拍板，2026-11-12 用户裁定删 all 档）：
   *  none=不发送（默认，防误发） | accepted=已确认参与的供应商
   *  （accepted 的对象解析口径——谈判/直接=回执确认、公告方式=已确认响应/投标意向——由
   *   bid-intent 并行工作线收口，见 spec 2026-11-12-supplier-bid-intent-design） */
  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['none', 'accepted'])
  notify?: 'none' | 'accepted' = 'none';
}
