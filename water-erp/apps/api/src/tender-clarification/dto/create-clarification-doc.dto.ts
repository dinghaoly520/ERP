import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClarificationDocDto {
  @IsString() @MinLength(2) @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(20000)
  content?: string;

  @IsOptional() @IsString()
  fileAssetId?: string; // 上传附件后传 FileAsset.id
}
