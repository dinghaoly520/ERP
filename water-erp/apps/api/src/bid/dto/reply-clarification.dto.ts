import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ReplyClarificationDto {
  @IsString() @IsNotEmpty()
  reply: string;

  @IsString() @IsOptional()
  status?: string;
}
