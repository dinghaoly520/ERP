import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '显示名称', example: '陈主任' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  displayName?: string;

  @ApiPropertyOptional({ description: '邮箱地址', example: 'chen@example.com', nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ description: '部门 ID', example: 'clx...', nullable: true })
  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @ApiPropertyOptional({ description: '手机号码', example: '13800138000', nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional({ description: '办公位置', example: '12楼1205室', nullable: true })
  @IsOptional()
  @IsString()
  officeLocation?: string | null;

  @ApiPropertyOptional({ description: '头像 URL', nullable: true })
  @IsOptional()
  @IsString()
  avatar?: string | null;
}
