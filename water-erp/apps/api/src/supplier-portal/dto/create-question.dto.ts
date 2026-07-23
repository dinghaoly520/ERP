import { IsOptional, IsString } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  question: string;

  /** 书面交流来函附件（FileAsset.id，可选） */
  @IsOptional()
  @IsString()
  fileAssetId?: string;
}
