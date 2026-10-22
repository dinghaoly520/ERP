import { IsString, IsOptional, IsNotEmpty, IsEmail } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class UpdateExpertProfileDto {
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @IsOptional()
  displayName?: string;

  @EmptyAsUndefined()
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  major?: string;
}
