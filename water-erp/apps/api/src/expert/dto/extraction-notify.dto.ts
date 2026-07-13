import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';

export class ExtractionNotifyDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  expertIds!: string[];

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  channels!: string[]; // 'in_app' | 'sms' | 'phone'

  @IsString() @IsNotEmpty()
  message!: string;
}
