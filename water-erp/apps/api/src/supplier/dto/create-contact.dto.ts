import { IsString, IsNotEmpty, IsEmail, IsOptional, IsBoolean, Matches, MaxLength } from 'class-validator';

export class CreateContactDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^1[3-9]\d{9}$/)
  phone: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsBoolean()
  isPrimary: boolean;

  @IsString() @IsOptional() @MaxLength(50)
  position?: string;
}