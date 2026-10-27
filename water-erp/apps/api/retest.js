"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const sm_field_crypto_1 = require("./src/common/crypto/sm-field-crypto");
const prisma = new client_1.PrismaClient();
const API = 'http://localhost:4001/api';
const PID = 'cmvqctpgx006pkof71ebre43z';
async function main() {
    const luo = (await prisma.bidExpert.findFirst({ where: { projectId: PID, expertName: '罗俊' }, select: { userId: true } }));
    const orig = (await prisma.expertProfile.findUnique({ where: { userId: luo.userId }, select: { phone: true } })).phone;
    await prisma.expertProfile.update({ where: { userId: luo.userId }, data: { phone: (0, sm_field_crypto_1.sealPii)('13368360619') } });
    try {
        const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' }, body: JSON.stringify({ username: 'Swhi-CGZX-05', password: 'Swhi-CGZX-05@2026' }) });
        const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
        const links = (await (await fetch(`${API}/expert-admin/projects/${PID}/rsvp-links`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie }, body: '{}' })).json()).links;
        const msg = `罗俊专家您好！四川水发勘测设计研究有限公司现有采购项目定于2026年03月20日 14:00在四川省成都市双流区红莲街开标评审，采购方式为谈判采购。您被选为评审专家，请务必于收到通知后15分钟内点击链接确认是否参加：${links[luo.userId]}，超时则自动视为放弃。`;
        const r = await (await fetch(`${API}/expert-admin/extract/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie }, body: JSON.stringify({ projectId: PID, expertIds: [luo.userId], channels: ['sms'], message: msg }) })).json();
        console.log('notify →', JSON.stringify(r));
    }
    finally {
        await prisma.expertProfile.update({ where: { userId: luo.userId }, data: { phone: orig } });
        console.log('罗俊原电话已恢复');
    }
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
//# sourceMappingURL=retest.js.map