import { IsOptional, IsString, Matches } from 'class-validator';

export class MarkReadDto {
  @IsString() @Matches(/^(public|supplier:.+)$/)
  roomKey!: string;

  /**
   * R5：客户端上报的"已读末条"消息 id。游标定在该消息的 createdAt 上，
   * 避免"拉历史→markRead"窗口内到达的消息被服务端 now() 误判已读
   * （供应商可能因此错过主持人指令）。缺省（旧前端不升级）→ 服务端 now()，向后兼容。
   */
  @IsOptional() @IsString()
  lastMessageId?: string;
}
