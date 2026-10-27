"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const sm_field_crypto_1 = require("./src/common/crypto/sm-field-crypto");
const prisma = new client_1.PrismaClient();
const API = 'http://localhost:4001/api';
async function main() {
    const SUP = 'cmqc8r6kn01knkoekdpflu2jp';
    const PMI = 'cmvqcbh0b0045kog1uqm5d0ja';
    await prisma.supplierContact.upsert({
        where: { supplierId_phoneIdx: { supplierId: SUP, phoneIdx: (0, sm_field_crypto_1.blindIndexPii)('13088007178') } },
        update: {},
        create: { supplierId: SUP, name: '测试联系人乙', phone: (0, sm_field_crypto_1.sealPii)('13088007178'), phoneIdx: (0, sm_field_crypto_1.blindIndexPii)('13088007178'), isPrimary: false },
    });
    console.log(`① 联系人 ${await prisma.supplierContact.count({ where: { supplierId: SUP } })} 名`);
    const loginRes = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
        body: JSON.stringify({ username: 'Swhi-CGZX-05', password: 'Swhi-CGZX-05@2026' }),
    });
    if (!loginRes.ok)
        throw new Error('登录失败 HTTP ' + loginRes.status + ' ' + JSON.stringify(await loginRes.json().catch(() => ({}))));
    const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const kw = { company: '四川水发勘测设计研究有限公司', projectName: '便携式全液压岩心钻机（800型）采购项目', projectCode: 'SWHI-TP-2026102701', method: '谈判采购' };
    const gen = await (await fetch(`${API}/ai/generate-notification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie },
        body: JSON.stringify({ contentMode: 'template', supplierNames: ['中国地质科学院探矿工艺研究所'], supplierIds: [SUP], projectId: PMI, validityDays: 1, requesterName: kw.company, projectName: kw.projectName, projectCode: kw.projectCode, procurementMethod: kw.method }),
    })).json();
    const link = gen.rsvpTokens[SUP];
    const content = `中国地质科学院探矿工艺研究所 您好！${kw.company}现邀请贵公司参与${kw.projectName}（项目编号：${kw.projectCode}），采购方式为${kw.method}。请在24小时内登录供应商门户或直接点击 ${link} 确认是否参加本次采购邀请，若超时则视为自动放弃。`;
    const notify = await (await fetch(`${API}/supplier/notify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie },
        body: JSON.stringify({ supplierIds: [SUP], channels: ['in_app', 'sms'], type: 'SELECTION_NOTIFY', title: `关于${kw.projectName}候选供应商邀请的通知`, content, link }),
    })).json();
    console.log('② /supplier/notify →', JSON.stringify(notify));
    const logs = await prisma.notificationDeliveryLog.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 3 * 60_000) }, channel: 'sms' },
        orderBy: { createdAt: 'desc' }, take: 3,
    });
    console.log('③ sms DeliveryLog:', JSON.stringify(logs.map(l => ({ status: l.status, error: l.error }))));
}
main().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
//# sourceMappingURL=e2e-notify-test.js.map