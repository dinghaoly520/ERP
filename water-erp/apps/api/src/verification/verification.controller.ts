import { Controller, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { VerificationService } from './verification.service';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

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
}
