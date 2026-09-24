import { IsString, IsNotEmpty, IsISO8601, IsOptional, IsBoolean, IsArray, IsIn, MaxLength } from 'class-validator';

/**
 * 开标决策通知（按时开标 / 延时开标 确认弹窗的发送载荷）：
 * 决策本身（startOpening / updateSchedule）由既有端点先行完成，本端点只负责
 * 按弹窗里配置的渠道与文案通知投标供应商（名册）与评标专家（排除已拒绝）。
 * 通知文案支持占位符：供应商侧 {供应商名称}、专家侧 {专家姓名}，逐人替换后发送。
 */
export class NotifyOpeningDecisionDto {
  /** 决策类型：ONTIME=按时开标；DELAY=延时开标（仅入审计留痕，不影响发送逻辑） */
  @IsIn(['ONTIME', 'DELAY'])
  decision: 'ONTIME' | 'DELAY';

  /** 通知所载开标时间：与项目当前值一致性校验（同 notifyScheduleChange 的 P2-8 口径） */
  @IsISO8601()
  openTime: string;

  // ── 供应商（名册全量）──
  @IsOptional() @IsBoolean()
  notifySuppliers?: boolean;

  @IsOptional() @IsArray() @IsIn(['in_app', 'sms'], { each: true })
  supplierChannels?: string[];

  @IsOptional() @IsString() @MaxLength(120)
  supplierTitle?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  supplierContent?: string;

  // ── 专家（排除已拒绝）──
  @IsOptional() @IsBoolean()
  notifyExperts?: boolean;

  @IsOptional() @IsArray() @IsIn(['in_app', 'sms'], { each: true })
  expertChannels?: string[];

  @IsOptional() @IsString() @MaxLength(120)
  expertTitle?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  expertContent?: string;
}
