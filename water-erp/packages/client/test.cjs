/**
 * toApiError 契约测试（零依赖，Node ≥18 原生 Response/assert）。
 * 跑法：node test.cjs（CI/本地均可，改 src 后先 npm run build 再跑）。
 *
 * 契约：message 取值优先级 body.error（后端规范体中文消息）→ fallback（调用方
 * 语境中文）→ `请求失败 (status)`；原始错误体整包挂 ApiError.data 供排查。
 * 2026-09-30 起因：web 门户 lib/api 多处把响应体原文塞进 Error message，
 * 用户看到裸 JSON（P2022 事件）——收敛为共享 toApiError 统一提取人类可读消息。
 */
const assert = require('node:assert/strict');
const { ApiError, toApiError } = require('./dist/index.js');

async function main() {
  assert.equal(typeof toApiError, 'function', 'toApiError 必须从包导出');

  // 1. 后端规范体：.error 中文消息 + code + 完整体挂 data
  const normalized = new Response(
    JSON.stringify({
      statusCode: 500,
      code: 'P2022',
      error: '数据操作失败，请稍后重试。',
      timestamp: '2026-09-30T01:37:54.009Z',
      path: '/api/dashboard',
    }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  );
  const err1 = await toApiError(normalized);
  assert.ok(err1 instanceof ApiError);
  assert.equal(err1.status, 500);
  assert.equal(err1.code, 'P2022');
  assert.equal(err1.message, '数据操作失败，请稍后重试。');
  assert.equal(err1.data.path, '/api/dashboard');

  // 2. .error 缺失时回落 fallback（.error 恒优先于 fallback）
  const noErrorField = new Response(JSON.stringify({ statusCode: 500, code: 'X' }), { status: 500 });
  const err2 = await toApiError(noErrorField.clone(), '加载仪表盘数据失败');
  assert.equal(err2.message, '加载仪表盘数据失败');
  const err2b = await toApiError(noErrorField, '加载仪表盘数据失败');
  assert.equal(err2b.message, '加载仪表盘数据失败'); // body 只能读一次，clone 分开验
  const withBoth = new Response(JSON.stringify({ error: '服务端业务错误' }), { status: 409 });
  const err2c = await toApiError(withBoth, '加载失败');
  assert.equal(err2c.message, '服务端业务错误');

  // 3. 无 fallback 的通用兜底
  const bare = new Response(JSON.stringify({ code: 'Y' }), { status: 503 });
  assert.equal((await toApiError(bare)).message, '请求失败 (503)');

  // 4. 非 JSON 响应体（网关纯文本等）
  const plainText = new Response('Bad Gateway', { status: 502 });
  assert.equal((await toApiError(plainText.clone(), '导出失败，请稍后重试。')).message, '导出失败，请稍后重试。');
  assert.equal((await toApiError(plainText)).message, '请求失败 (502)');

  // 5. Nest 旧格式 body.message（ValidationPipe 数组取首条；.error 恒优先）
  const validation = new Response(
    JSON.stringify({ statusCode: 400, message: ['title 不能为空', 'x'], error: 'Bad Request' }),
    { status: 400 },
  );
  assert.equal((await toApiError(validation.clone(), '保存失败')).message, 'Bad Request'); // .error 优先
  const legacy = new Response(JSON.stringify({ statusCode: 400, message: ['title 不能为空'] }), { status: 400 });
  assert.equal((await toApiError(legacy.clone(), '保存失败')).message, 'title 不能为空');
  const legacyStr = new Response(JSON.stringify({ message: '参数错误' }), { status: 400 });
  assert.equal((await toApiError(legacyStr)).message, '参数错误');

  console.log('toApiError: 9 cases passed');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
