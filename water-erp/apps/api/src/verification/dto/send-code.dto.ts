import { IsString, IsIn } from 'class-validator';

export const VERIFICATION_SCENES = ['expert_sign_in'] as const;
export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

export class SendCodeDto {
  @IsString()
  @IsIn(VERIFICATION_SCENES)
  scene: VerificationScene;

  @IsString()
  targetId: string;
}
