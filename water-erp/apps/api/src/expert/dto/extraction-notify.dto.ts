import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, ArrayMinSize, IsBoolean } from 'class-validator';

export class ExtractionNotifyDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  expertIds!: string[];

  @IsArray() @ArrayMinSize(1) @IsIn(['in_app', 'sms', 'phone', 'email'], { each: true })
  channels!: string[]; // 'in_app' | 'sms' | 'phone' | 'email'

  // 必填（2026-11-10 用户裁定：取消服务端兜底文案）——文案只能来自向导固定语句/操作人填写，
  // 服务端不再自拟。历史「话术未生成提交空串」场景已随固定语句设计（确定性拼装）消失。
  @IsString() @IsNotEmpty()
  message!: string;

  /** 候补文案（无确认链接）：true=正文原样直发——不追加回执链接尾段、不刷新 RSVP token（2026-10-27） */
  @IsBoolean() @IsOptional()
  noRsvpLink?: boolean;
}
