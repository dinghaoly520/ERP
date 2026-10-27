"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const bes = await prisma.bidExpert.findMany({ where: { projectId: 'cmvqctpgx006pkof71ebre43z' }, select: { id: true, userId: true, expertRole: true } });
    for (const be of bes) {
        const exists = await prisma.expertInvitationLog.findFirst({ where: { bidExpertId: be.id, action: 'NOTIFIED' } });
        if (!exists) {
            await prisma.expertInvitationLog.create({
                data: { bidExpertId: be.id, projectId: 'cmvqctpgx006pkof71ebre43z', userId: be.userId, action: 'NOTIFIED', actorType: 'SYSTEM', reason: '补记存量发送（留痕功能上线前已通知）' },
            });
            console.log('补记', be.id.slice(-6), be.expertRole);
        }
    }
}
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=backfill.js.map