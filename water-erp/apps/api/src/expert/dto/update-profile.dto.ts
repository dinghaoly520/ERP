import { IsString, IsOptional, IsNotEmpty, IsEmail } from 'class-validator';

export class UpdateExpertProfileDto {
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @IsOptional()
  displayName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  major?: string;
}
