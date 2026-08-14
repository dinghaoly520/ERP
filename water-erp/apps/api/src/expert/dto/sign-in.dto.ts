import { IsOptional, IsString } from 'class-validator';

export class SignInDto {
  /** 签到拍照留痕的 FileAsset id（category=expert_signin_photo，可选） */
  @IsOptional()
  @IsString()
  photoAssetId?: string;
}
