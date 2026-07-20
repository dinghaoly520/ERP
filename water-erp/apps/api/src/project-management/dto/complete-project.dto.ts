import { IsBoolean, IsOptional } from 'class-validator';

export class CompleteProjectDto {
  @IsBoolean()
  confirmedCompleted!: boolean;

  @IsBoolean()
  @IsOptional()
  allowIncomplete?: boolean; // 流标归档等：跳过阶段完成校验
}
