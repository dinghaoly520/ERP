import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { IsString, IsNotEmpty, IsOptional, IsIn, Matches } from 'class-validator';
import { VerificationService } from './verification.service';

class SendRegistrationCodeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^1\d{10}$/, { message: '请输入有效的手机号' })
  phone: string;

  /** 场景决定短信模板：供应商注册（默认）/ 管理端注册 / 管理端忘记密码。 */
  @IsOptional()
  @IsIn(['supplier_registration', 'management_registration', 'management_password_reset', 'supplier_password_reset'])
  scene?: 'supplier_registration' | 'management_registration' | 'management_password_reset' | 'supplier_password_reset';
}

class VerifyRegistrationCodeDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // ── 注册专用（公开，无需登录）──

  @Post('send-registration-code')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  sendRegistrationCode(
    @Body() dto: SendRegistrationCodeDto,
    @Req() req: Request,
  ) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || '127.0.0.1';
    return this.verificationService.sendRegistrationCode(dto.phone, clientIp, dto.scene);
  }

  @Post('verify-registration-code')
  @Public()
  verifyRegistrationCode(@Body() dto: VerifyRegistrationCodeDto) {
    return this.verificationService.verifyRegistrationCode(dto.phone, dto.code);
  }

  /** 验证码预检（不消费）：注册页输满 6 位即时反馈；错误同样计入 5 次尝试上限。 */
  @Post('check-registration-code')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  checkRegistrationCode(@Body() dto: VerifyRegistrationCodeDto) {
    return this.verificationService.checkRegistrationCode(dto.phone, dto.code);
  }
}
