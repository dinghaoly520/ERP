import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** 候选供应商对比面板批量取库内实时资料（2026-09-09）。 */
export class CompareProfilesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  ids!: string[];
}
