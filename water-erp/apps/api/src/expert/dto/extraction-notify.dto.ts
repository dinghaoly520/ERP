import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, ArrayMinSize } from 'class-validator';

export class ExtractionNotifyDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  expertIds!: string[];

  @IsArray() @ArrayMinSize(1) @IsIn(['in_app', 'sms', 'phone', 'email'], { each: true })
  channels!: string[]; // 'in_app' | 'sms' | 'phone' | 'email'

  // 允许空/缺省：service 内已有默认文案兜底（`message || 您已被选为…`）。
  // 前端「发送通知」在话术未生成时提交空串，原 @IsNotEmpty 会把 5 家专家通知全部 400。
  @IsString() @IsOptional()
  message?: string;
}
