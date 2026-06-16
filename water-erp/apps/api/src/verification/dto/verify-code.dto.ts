import { IsString, IsIn, Length } from 'class-validator';
import { VERIFICATION_SCENES, VerificationScene } from './send-code.dto';

export class VerifyCodeDto {
  @IsString()
  @IsIn(VERIFICATION_SCENES)
  scene: VerificationScene;

  @IsString()
  targetId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
