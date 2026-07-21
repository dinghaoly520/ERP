import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength } from 'class-validator';

export class CreateExpertDto {
  @IsString() @IsNotEmpty()
  username!: string;

  @IsString() @IsNotEmpty()
  displayName!: string;

  @IsString() @MinLength(6)
  password!: string;

  @IsString() @IsNotEmpty()
  specialty!: string;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() employer?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() ethnicity?: string;
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
}
