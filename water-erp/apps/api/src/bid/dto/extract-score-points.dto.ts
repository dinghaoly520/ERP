import { IsOptional, IsString } from 'class-validator';

/** AI 提取得分点的提取源（2026-09-26 双入口分流）：
 *  - 不传 = 自动解析：该轮「采购文件」步骤最新附件（不限类型）
 *  - 显式传 = 指定附件直读——完成向导传正式盖章版指针（OCR 正式文件）；
 *    「评分标准」按钮多文件时用户选定的源（校验须归属本项目 03 步骤） */
export class ExtractScorePointsDto {
  @IsString()
  @IsOptional()
  sourceAttachmentId?: string;
}
