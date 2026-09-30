import { IsString } from 'class-validator';

export class UpdateConfigDto {
  // R7-3 澄清②：允许空串清空（此前 @IsNotEmpty 拒空串，清空报英文 400 且页面只说"发布失败"）
  @IsString() value: string;
}
