import { IsOptional, IsString, MaxLength } from 'class-validator';

/** CTS A-216 联系人人员类别/执业证书标注 */
export class UpdateContactPersonnelDto {
  /** 法人代表/项目经理/技术负责人/质量安全负责人/持证人员/普通联系人 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  personnelType?: string;

  /** 执业资格/证书，如：一级建造师(水利水电) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  certTitle?: string;
}
