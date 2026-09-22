import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsIn } from 'class-validator';

/** 工位迁移领取（2026-09-22 修正方案）：票据（免闸4）+ 密码重证 */
export class ExpertTransferClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  ticket!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

/** 迁移后留档照登记（检测级证据；skipped=摄像头不可用跳过，如实留痕） */
export class TransferPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  photoAssetId?: string | null;

  @IsOptional()
  @IsIn(['passed', 'unchecked'])
  occlusion?: 'passed' | 'unchecked' | null;

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}
