import { IsIn, IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class SendMessageDto {
  @IsIn(['PUBLIC', 'PRIVATE'])
  roomType!: 'PUBLIC' | 'PRIVATE';

  @IsOptional() @IsString()
  supplierId?: string; // PRIVATE 必填（哪家供应商的私聊）

  @IsString() @IsNotEmpty() @MaxLength(2000)
  content!: string;
}
