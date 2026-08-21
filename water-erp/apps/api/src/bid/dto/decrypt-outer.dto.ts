import { IsOptional, IsString } from 'class-validator';

/** 主持端解外层（dual-v2）：supplierId 缺省 = 批量（全部未解外层的 dual-v2 供应商逐家串行） */
export class DecryptOuterDto {
  @IsString() @IsOptional()
  supplierId?: string;
}
