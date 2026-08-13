import { Injectable } from '@nestjs/common';

/**
 * 评标签字包 docx 排版（Task 3 实现完整文档树）。
 * 占位：Task 2 仅需本类可注入，Task 3 补全 buildChildren/generateDocument。
 */
@Injectable()
export class BidSignPacketDocxService {
  async generateDocument(_snapshot: unknown): Promise<Buffer> {
    throw new Error('BidSignPacketDocxService.generateDocument not implemented yet');
  }
}
