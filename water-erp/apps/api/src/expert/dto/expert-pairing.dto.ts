import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsIn } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

/** 平板配对领取（TAB-SYNC-01，2026-09-22 迁移制演进）：票据（免闸4）+ 密码重证 */
export class ExpertPairingClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  ticket!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

/** 配对后留档照登记（检测级证据；skipped=摄像头不可用跳过，如实留痕） */
export class PairingPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  photoAssetId?: string | null;

  @EmptyAsUndefined()
  @IsOptional()
  @IsIn(['passed', 'unchecked'])
  occlusion?: 'passed' | 'unchecked' | null;

  @EmptyAsUndefined()
  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}
