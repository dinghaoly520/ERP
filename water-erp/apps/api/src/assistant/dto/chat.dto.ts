import { IsString, IsOptional, IsObject } from 'class-validator';

export class ChatDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
