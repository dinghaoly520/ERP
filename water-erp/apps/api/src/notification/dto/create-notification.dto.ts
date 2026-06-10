import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateNotificationDto {
  @IsString() @IsNotEmpty()
  userId: string;

  @IsString() @IsNotEmpty()
  type: string;

  @IsString() @IsNotEmpty()
  title: string;

  @IsString() @IsNotEmpty()
  content: string;

  @IsString() @IsOptional()
  link?: string;
}