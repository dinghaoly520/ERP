import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { VerificationService } from './verification.service';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

class SendRegistrationCodeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^1\d{10}$/, { message: '请输入有效的手机号' })
  phone: string;
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

  @Post('send-code')
  @Roles('bid_expert')
  sendCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendCodeDto,
    @Req() req: Request,
  ) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || '127.0.0.1';
    return this.verificationService.sendCode(dto.scene, userId, dto.targetId, clientIp);
  }

  @Post('verify-code')
  @Roles('bid_expert')
  verifyCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: VerifyCodeDto,
  ) {
    return this.verificationService.verifyCode(dto.scene, userId, dto.targetId, dto.code);
  }

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
    return this.verificationService.sendRegistrationCode(dto.phone, clientIp);
  }

  @Post('verify-registration-code')
  @Public()
  verifyRegistrationCode(@Body() dto: VerifyRegistrationCodeDto) {
    return this.verificationService.verifyRegistrationCode(dto.phone, dto.code);
  }
}
