/* =================================================================
   ca-bid-operation.controller — dual-v3 投递链 prepare/signing-payload
   阶段2 Task3（附录 §5.C）

   prepare → 服务端分配 operationId + 冻结 CaSignContext + 120s 挑战
   signing-payload → 接收最终信封 → 冻结 canonical 文本与 sha256
   ================================================================= */
import { Controller, Post, Body, Param, Req, HttpCode, HttpStatus, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CaOperationService } from './ca-operation.service';
import { validateV3Envelope } from '@water-erp/ukey';
import { IsString, IsIn, IsOptional, IsInt, IsArray, Min, IsObject } from 'class-validator';

export class CaPrepareDto {
  @IsString() @IsIn(['submit', 'reupload', 'decrypt-upload', 'receipt', 'opening-confirm', 'clarification'])
  action!: string;
  @IsOptional() @IsInt() @Min(0) baseRevision?: number;
  @IsOptional() @IsArray() candidateAssetIds?: string[];
  @IsOptional() @IsInt() @Min(0) recordRevision?: number;
}

export class CaSigningPayloadDto {
  @IsObject() envelope!: unknown;
}

@ApiTags('CA 投递操作')
@Controller('supplier-portal/bid-submissions/:projectId/operations')
export class CaBidOperationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationService: CaOperationService,
  ) {}

  @Post('prepare')
  @Roles('supplier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '投递链 prepare——分配 operationId + 冻结上下文' })
  async prepare(
    @Param('projectId') projectId: string,
    @Body() dto: CaPrepareDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.sub;
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });

    // 创建持久 CaOperation
    const payloadHash = createHash('sha256').update(JSON.stringify({ projectId, supplierId: supplier.id, ...dto })).digest('hex');
    const operationId = await this.operationService.create({
      subjectType: 'supplier',
      subjectId: supplier.id,
      purpose: dto.action,
      payloadHash,
    });

    // 构建 CaSignContext（服务端冻结原文）
    const context = {
      version: 1 as const,
      purpose: dto.action,
      operationId,
      projectId,
      supplierId: supplier.id,
      ...(dto.baseRevision !== undefined ? { baseRevision: dto.baseRevision } : {}),
      ...(dto.recordRevision !== undefined ? { recordRevision: dto.recordRevision } : {}),
    };

    // 冻结 context 到操作
    await this.operationService.toVerifying(operationId); // PREPARED → 等待 payload
    const canonical = JSON.stringify(context);
    await this.operationService.attachPayload(operationId, canonical, createHash('sha256').update(canonical, 'utf8').digest('hex'));

    return {
      operationId,
      context,
      canonical,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      purpose: dto.action,
    };
  }

  @Post(':operationId/signing-payload')
  @Roles('supplier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '投递链 signing-payload——冻结最终信封原文' })
  async signingPayload(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() dto: CaSigningPayloadDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.sub;
    // subjectId=supplier.id（prepare 以供应商域落列）——比对同域，勿用 User id（域错配恒 403）
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });
    const op = await this.operationService.findById(operationId);
    if (!op) throw new NotFoundException({ error: '操作不存在', code: 'OPERATION_NOT_FOUND' });
    if (op.subjectId !== supplier.id) throw new ForbiddenException({ error: '无权访问', code: 'FORBIDDEN' });
    // prepare 落点=PAYLOAD_READY（context 已冻结）；信封冻结替换载荷——两态均可
    if (op.status !== 'VERIFYING' && op.status !== 'PAYLOAD_READY') throw new ConflictException({ error: '操作状态不允许提交载荷', code: 'OPERATION_STATE_INVALID' });

    // 仅 submit/reupload 提交信封；receipt/opening-confirm 在 prepare 冻结
    if (op.purpose === 'submit' || op.purpose === 'reupload') {
      // I2（评审）：信封冻结单次——已冻结信封再换不同信封覆盖返回 409（防签名原文被替换）。
      // M-3 留痕（复审）：读-判-写非原子——并发双签窗内后写可覆盖；兜底=P7 验签针对
      // 最终 canonical + commit CAS 单次，最坏自伤（对手覆盖自己的操作），可接受
      if ((op.result as any)?.envelopeFrozen) {
        throw new ConflictException({ error: '操作已冻结信封载荷，不可重复提交或替换', code: 'ENVELOPE_ALREADY_FROZEN' });
      }
      const validation = validateV3Envelope(dto.envelope);
      if (!validation.ok) {
        throw new BadRequestException({ error: `信封校验失败: ${validation.errors.join('; ')}`, code: 'ENVELOPE_INVALID' });
      }
      const envelopeJson = JSON.stringify(dto.envelope);
      const envelopeHash = createHash('sha256').update(envelopeJson, 'utf8').digest('hex');
      // 冻结信封原文到 operation（envelopeFrozen 标记区分 context 冻结与信封冻结）
      await this.operationService.attachPayload(operationId, envelopeJson, envelopeHash, { envelopeFrozen: true } as any);
      return {
        canonical: envelopeJson,
        canonicalSha256: envelopeHash,
        signatureFormat: 'scca-pkcs7-base64' as const,
        signingFingerprint: (dto.envelope as any)?.context?.signingCertFingerprint,
      };
    }

    throw new BadRequestException({ error: `purpose='${op.purpose}' 不通过此端点提交信封`, code: 'PURPOSE_NOT_ENVELOPE' });
  }
}
