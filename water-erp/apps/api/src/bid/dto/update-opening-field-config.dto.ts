import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { OpeningFieldDef } from '../opening-field-config.util';

/** A-113：项目唱标字段配置写入（body 二选一）。fields 项内层形状不在此逐项装饰——统一由 service 层
 *  assertValidOpeningFieldConfig 校验（key 唯一/法定四键不可删/type 固定等，错误带域内 code）。 */
export class UpdateOpeningFieldConfigDto {
  /** 直接给配置：法定四键必在不可删/type 不可改，动态键可增列/调序/改标签 */
  @IsArray()
  @IsOptional()
  fields?: OpeningFieldDef[];

  /** 从 WorkTemplate(kind=opening_record) 取 content.fields */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  fromTemplateId?: string;
}
