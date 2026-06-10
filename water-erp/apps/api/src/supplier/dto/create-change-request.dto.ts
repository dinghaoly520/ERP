import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateChangeRequestDto {
  @IsString() @IsNotEmpty()
  fieldName: string;

  @IsString() @IsNotEmpty()
  fieldLabel: string;

  @IsString() @IsNotEmpty()
  newValue: string;

  @IsString() @IsOptional()
  reason?: string;
}