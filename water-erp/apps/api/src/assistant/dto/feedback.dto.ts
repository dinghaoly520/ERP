import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/** 回答反馈（2026-11-19 问答改造）——同属主同消息覆盖、再点同值取消（service 语义） */
export class FeedbackDto {
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @IsIn(['UP', 'DOWN'])
  rating: 'UP' | 'DOWN';
}
