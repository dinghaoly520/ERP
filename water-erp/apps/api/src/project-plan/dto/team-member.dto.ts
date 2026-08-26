import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  userId!: string;

  /** 负责人 | 技术 | 商务 | 监督 | 其他 */
  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  duty?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  duty?: string;
}
