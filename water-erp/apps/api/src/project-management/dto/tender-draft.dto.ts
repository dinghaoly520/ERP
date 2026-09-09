import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** 采购文件编写·项目草稿（跨设备同步）。drafts = 前端 TenderDraftsState（全部模板类型合并）。 */
export class SaveTenderDraftDto {
  @IsObject()
  drafts!: Record<string, unknown>;
}

/** 「保存当前」产生的历史版本（恢复点）。 */
export class CreateTenderDraftVersionDto {
  @IsObject()
  drafts!: Record<string, unknown>;

  // 展示用时间标签，前端生成；缺省时服务端按当前时间补一个
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
