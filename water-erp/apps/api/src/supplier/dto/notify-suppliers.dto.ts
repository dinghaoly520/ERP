import { IsString, IsNotEmpty, IsArray, ArrayMinSize, ArrayMaxSize, IsIn, MaxLength } from 'class-validator';

/** B4：通知供应商入参校验——此前为内联 body，channels/数组无校验，可被滥用批量短信轰炸。 */
export class NotifySuppliersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true })
  supplierIds: string[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(['in_app', 'sms', 'email'], { each: true })
  channels: string[];

  @IsString() @IsNotEmpty() @MaxLength(40)
  type: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  title: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  content: string;
}
