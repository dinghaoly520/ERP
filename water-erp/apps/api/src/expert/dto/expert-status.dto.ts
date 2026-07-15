import { IsBoolean, IsString } from 'class-validator';

/**
 * 启用/停用专家。
 * 取代 controller 内联 body —— 内联类型无 class-validator 装饰器，ValidationPipe 不校验，
 * 字符串 "false" 会被当 truthy（反而启用专家）。DTO + @IsBoolean 使非布尔值直接 400。
 */
export class SetAvailabilityDto {
  @IsBoolean()
  available!: boolean;
}

/** 人工确认专家退库 */
export class ConfirmRetireDto {
  @IsString()
  reason!: string;
}
