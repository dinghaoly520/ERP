import { IsBoolean, IsObject, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * A-94：投标草稿/递交服务端格式校验（此前 /draft /submit 裸收 body 无校验）。
 * 注意：全局 ValidationPipe whitelist:true 会剥落无装饰器字段——每个透传字段都必须有装饰器，
 * 否则静默蒸发（splitFiles/clientDeks/envelope 用 @IsObject() 放行嵌套结构）。
 */
export class SaveBidDraftDto {
  /** 投标报价：数字字符串（前端口径 万元或元，≥10000 视为元），≤4 位小数 */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,4})?$/, { message: '投标报价须为不超过 4 位小数的数字' })
  bidPrice?: string;

  /** 工期：自由文本（如「90 日历天」），只做长度校验 */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value?.trim()))
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '工期须为 1-50 字符' })
  deliveryPeriod?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() @MaxLength(500) qualityCommitment?: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() @MaxLength(500) technicalFile?: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() @MaxLength(500) businessFile?: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() @MaxLength(500) coverLetter?: string;

  @IsOptional() @IsString() @MaxLength(64) technicalFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) businessFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) coverLetterAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) bidBondAssetId?: string;
  /** P0-1 完整/拆分模型别名（服务层 normalizeBidFileAssets 归一） */
  @IsOptional() @IsString() @MaxLength(64) fullBidFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) coverLetterFileAssetId?: string;

  /** P0-1 前端完整/拆分模型（服务层归一到三角色契约）——嵌套结构宽松放行 */
  @IsOptional() @IsObject() splitFiles?: { tech?: any; biz?: any; other?: any };
  /** E2EE 客户端加密密钥（assetId → "keyHex:ivHex:authTagHex"） */
  @IsOptional() @IsObject() clientDeks?: Record<string, string>;
}

/** 递交在草稿字段之上增加双信封 v2 信封与证书签名（服务层验签） */
export class SubmitBidDto extends SaveBidDraftDto {
  @IsOptional() @IsObject() envelope?: any; // DualEnvelope（@water-erp/ukey 类型，仅类型引用避免循环依赖）
  @IsOptional() @IsString() @MaxLength(4096) signature?: string;
  /** 旧轨 SM2 抗抵赖签名对：服务层 signature+fileHash 联合触发验签——缺装饰器被剥落后验签静默跳过（SHA-256 hex=64） */
  @IsOptional() @IsString() @MaxLength(128) fileHash?: string;
  /** P1-1 旧轨代解密授权（办法第30条留痕）：服务层递交闸门要求 ===true——缺装饰器被剥落后闸门协议层不可满足 */
  @IsOptional() @IsBoolean() hostDecryptAuthorized?: boolean;
}
