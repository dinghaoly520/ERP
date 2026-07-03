const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3005/login', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="输入账号"]', '陈主任');
  await page.fill('input[placeholder="输入密码"]', 'czr@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  // Compare computed styles of 资料修改 (button) label vs a Link item label
  const diag = await page.evaluate(() => {
    const nav = document.querySelector('aside nav');
    if (!nav) return { error: 'no nav' };
    const profileBtn = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent.trim() === '资料修改');
    const personalLink = Array.from(nav.querySelectorAll('a')).find((a) => a.textContent.trim() === '个人中心');
    const spanOf = (el) => el?.querySelector('span') ?? null;
    const iconOf = (el) => el?.querySelector('svg') ?? null;
    const ps = spanOf(profileBtn);
    const ls = spanOf(personalLink);
    const pi = iconOf(profileBtn);
    const li = iconOf(personalLink);
    const pick = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, color: cs.color };
    };
    return {
      profileText: pick(ps),
      profileIcon: pick(pi),
      linkText: pick(ls),
      linkIcon: pick(li),
    };
  });

  console.log('DIAG:', JSON.stringify(diag, null, 2));
  await page.screenshot({ path: '/tmp/diag-sidebar.png', fullPage: false });
  console.log('URL:', page.url());
  await browser.close();
})().catch((e) => { console.error('SCRIPT_ERROR:', e); process.exit(1); });
