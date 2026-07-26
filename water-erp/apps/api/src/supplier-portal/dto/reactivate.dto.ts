import { IsString, IsNotEmpty } from 'class-validator';

export class ReactivateDto {
  @IsString() @IsNotEmpty()
  username: string;

  @IsString() @IsNotEmpty()
  password: string;

  @IsString() @IsNotEmpty()
  invitationCode: string;
}
