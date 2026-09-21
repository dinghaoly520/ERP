import { createRequire } from 'module';
const require = createRequire('/Users/qihao/ERP2/ERP/water-erp/');
const { chromium } = require('/Users/qihao/ERP2/ERP/water-erp/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const res = await page.request.post('http://localhost:4001/api/auth/login', {
  data: { username: 'Swhi-CGZX-admin', password: 'Swhi-CGZX-admin@2026' },
  headers: { 'X-Portal': 'web', 'Content-Type': 'application/json' },
});
const tok = (await res.json()).access_token;
const H = { 'X-Portal': 'web', 'Cookie': `token_web=${tok}`, 'Content-Type': 'application/json' };

// 找有 rsvp 的 ACTIVE 项目
const active = await (await page.request.get('http://localhost:4001/api/project-management?status=ACTIVE', { headers: H })).json();
console.log('ACTIVE 项目数:', active.length);
// 逐个试，直到找到 notifiedCount>0 的
let target = null, result = null;
for (const a of active) {
  const t = await (await page.request.post(`http://localhost:4001/api/project-management/${a.id}/terminate`, { data: { reason: '通知验证（临时）', notify: 'accepted' }, headers: H })).json();
  console.log(`· ${a.title.slice(0, 18)}… → notifiedCount=${t.notifiedCount}`);
  if (t.notifiedCount > 0) { target = a; result = t; break; }
}
console.log(target ? `命中: ${target.title}` : '无项目有已确认供应商');
await browser.close();
