import { IsIn, IsOptional, IsString } from 'class-validator';

export class SignInDto {
  /** 签到拍照留痕的 FileAsset id（category=expert_signin_photo；self/host 态必填，off 应急态可选） */
  @IsOptional()
  @IsString()
  photoAssetId?: string;

  /** 客户端遮挡检测结论：passed=检测通过；unchecked=检测不可用降级（R3，spec §4.1） */
  @IsOptional()
  @IsIn(['passed', 'unchecked'])
  occlusion?: 'passed' | 'unchecked';
}
