import { IsIn, IsOptional, IsString } from 'class-validator';

/** PII 明文揭示（等保+密评）：entity 白名单；揭示动作写 SensitiveAccessLog 审计 */
export class RevealSupplierFieldDto {
  @IsIn(['supplier', 'contact', 'bankAccount'])
  entity!: 'supplier' | 'contact' | 'bankAccount';

  /** contact/bankAccount 必传（子记录归属校验）；supplier 主记录无需 */
  @IsOptional() @IsString()
  targetId?: string;

  @IsString()
  field!: string; // 服务端按 entity 白名单二次校验（组合枚举不适合 DTO 层展开）
}
