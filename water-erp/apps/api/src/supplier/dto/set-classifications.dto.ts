import { IsArray, ArrayMaxSize, IsString } from 'class-validator';

/** B4：设置供应商分类入参校验——此前为内联 `{ classificationIds: string[] }`，非法 id 直接撞 FK 报 500。 */
export class SetClassificationsDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  classificationIds: string[];
}
