import { IsString, IsOptional, IsEmail } from 'class-validator';

export class UpdateExpertProfileDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  major?: string;
}
