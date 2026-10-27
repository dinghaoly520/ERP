"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const sm_field_crypto_1 = require("./src/common/crypto/sm-field-crypto");
const prisma = new client_1.PrismaClient();
const API = 'http://localhost:4001/api';
const PID = 'cmvqctpgx006pkof71ebre43z';
const TEST_PHONE = '13368360619';
async function main() {
    const bes = await prisma.bidExpert.findMany({ where: { projectId: PID }, select: { userId: true, expertName: true } });
    const backup = [];
    for (const be of bes) {
        const p = await prisma.expertProfile.findUnique({ where: { userId: be.userId }, select: { phone: true } });
        backup.push({ userId: be.userId, phone: p?.phone ?? null });
        await prisma.expertProfile.update({ where: { userId: be.userId }, data: { phone: (0, sm_field_crypto_1.sealPii)(TEST_PHONE) } });
    }
    console.log(`① ${bes.length} 位专家电话已临时指向测试号（原值已备份）`);
    try {
        const loginRes = await fetch(`${API}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
            body: JSON.stringify({ username: 'Swhi-CGZX-05', password: 'Swhi-CGZX-05@2026' }),
        });
        if (!loginRes.ok)
            throw new Error('登录失败');
        const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
        const links = (await (await fetch(`${API}/expert-admin/projects/${PID}/rsvp-links`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie }, body: '{}',
        })).json()).links || {};
        const luo = bes.find(b => b.expertName === '罗俊');
        const link = links[luo.userId];
        const msg = `${luo.expertName}专家您好！四川水发勘测设计研究有限公司现有采购项目定于2026年03月20日 14:00在四川省成都市双流区红莲街开标评审，采购方式为谈判采购。您被选为评审专家，请务必于收到通知后15分钟内点击链接确认是否参加：${link}，超时则自动视为放弃。`;
        const notifyRes = await fetch(`${API}/expert-admin/extract/notify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie },
            body: JSON.stringify({ projectId: PID, expertIds: [luo.userId], channels: ['sms'], message: msg }),
        });
        const notify = await notifyRes.json();
        console.log('④ /extract/notify →', JSON.stringify(notify));
        const logs = await prisma.notificationDeliveryLog.findMany({
            where: { createdAt: { gte: new Date(Date.now() - 3 * 60_000) }, channel: 'sms' },
            orderBy: { createdAt: 'desc' }, take: 2,
        });
        console.log('⑤ sms DeliveryLog:', JSON.stringify(logs.map(l => ({ status: l.status, error: l.error }))));
    }
    finally {
        for (const b of backup) {
            await prisma.expertProfile.update({ where: { userId: b.userId }, data: { phone: b.phone } });
        }
        console.log(`⑥ 已恢复 ${backup.length} 位专家原档案电话`);
    }
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
//# sourceMappingURL=e2e-expert-sms-test.js.map