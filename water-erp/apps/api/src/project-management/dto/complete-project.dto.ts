import { IsBoolean, IsOptional } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class CompleteProjectDto {
  @IsBoolean()
  confirmedCompleted!: boolean;

  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  allowIncomplete?: boolean; // 流标归档等：跳过阶段完成校验
}
