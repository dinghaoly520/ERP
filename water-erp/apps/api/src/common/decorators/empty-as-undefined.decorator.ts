import { Transform } from 'class-transformer';

/**
 * 空串归一 undefined（2026-10-22，资质日期报错判例泛化）：
 * class-validator 的 @IsOptional() 只跳过 null/undefined，不认空串——表单未填字段
 * 以 "" 直传时会被 IsDateString/IsNumber/IsInt/IsEmail/IsEnum/IsBoolean/IsArray
 * 误伤成「该项应为有效日期 string」类病句（不指名字段/中英混杂）。
 * 仅用于这些空串本就不可能合法的校验器字段（IsString 等空串合法的字段禁用——
 * "" 在那里可能是「清空字段」的显式语义）。
 */
export function EmptyAsUndefined() {
  return Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
}
