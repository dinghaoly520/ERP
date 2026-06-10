import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateClassificationDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @MaxLength(20)
  code: string;

  @IsString() @IsOptional()
  description?: string;
}

export class UpdateClassificationDto {
  @IsString() @IsOptional() @MaxLength(50)
  name?: string;

  @IsString() @IsOptional() @MaxLength(20)
  code?: string;

  @IsString() @IsOptional()
  description?: string;
}