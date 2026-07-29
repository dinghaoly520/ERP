import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateConfigDto {
  @IsString() @IsNotEmpty() value: string;
}
