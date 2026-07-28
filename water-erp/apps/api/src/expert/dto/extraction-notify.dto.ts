import { IsString, IsNotEmpty, IsArray, IsIn, ArrayMinSize } from 'class-validator';

export class ExtractionNotifyDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  expertIds!: string[];

  @IsArray() @ArrayMinSize(1) @IsIn(['in_app', 'sms', 'phone', 'email'], { each: true })
  channels!: string[]; // 'in_app' | 'sms' | 'phone' | 'email'

  @IsString() @IsNotEmpty()
  message!: string;
}
