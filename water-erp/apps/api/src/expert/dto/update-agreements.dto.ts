import { IsBoolean, IsOptional } from 'class-validator';

/** P4: 保密承诺/评标纪律签署 */
export class UpdateAgreementsDto {
  @IsBoolean() @IsOptional() confidentialityAgreed?: boolean;
  @IsBoolean() @IsOptional() disciplineAgreed?: boolean;
}
