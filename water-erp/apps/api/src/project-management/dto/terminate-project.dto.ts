import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class TerminateProjectDto {
  @IsString()
  @IsNotEmpty({ message: '请填写终止原因。' })
  @MinLength(2, { message: '终止原因至少 2 个字符。' })
  @MaxLength(1000)
  reason!: string;

  /** 终止通知对象（2026-09-20 拍板：由用户在终止弹窗选择）：
   *  none=不发送（默认，防误发） | accepted=已确认参与的供应商 | all=全部受邀供应商 */
  @IsOptional()
  @IsIn(['none', 'accepted', 'all'])
  notify?: 'none' | 'accepted' | 'all' = 'none';
}
