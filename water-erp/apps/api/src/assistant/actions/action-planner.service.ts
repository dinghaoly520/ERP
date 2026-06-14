import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActionPlannerService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(params: {
    conversationId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    payloadJson: Record<string, unknown>;
    riskLevel: 'low' | 'medium' | 'high';
  }) {
    return this.prisma.assistantActionLog.create({
      data: {
        conversationId: params.conversationId,
        actionType: params.actionType,
        targetType: params.targetType,
        targetId: params.targetId,
        payloadJson: params.payloadJson as any,
        riskLevel: params.riskLevel,
        status: 'pending',
      },
    });
  }
}
