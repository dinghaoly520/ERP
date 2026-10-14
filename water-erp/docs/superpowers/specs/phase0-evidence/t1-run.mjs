globalThis.window = globalThis;                     // 浏览器全局垫片（readPin 不在场景内，无需 document）
await import('./fake-ws.js');
await import('./transport-test.js');
const { FakeWS } = window;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra='') => { results.push(`${ok?'PASS':'FAIL'} ${name}${extra?' — '+extra:''}`); };

// ── T1-a 超时只关自己的连接；旧 socket 帧不误配 ──
FakeWS.script = [() => {}];
const p1 = P0.rawCall('SOF_GetVersion', []);
const r1 = await p1;
check('T1-a1 超时返回 _timeout', r1 && r1._timeout === true);
check('T1-a2 旧 socket 被关闭', FakeWS.instances[0].readyState === 3);
FakeWS.script = [(s) => s.emit('message', { data: JSON.stringify({ action: 'SOF_GetUserList', retValue: 'a||c&&&' }) })];
const r2 = await P0.userList();
check('T1-a3 新调用拿到正确回包', r2 && r2.retValue === 'a||c&&&');
FakeWS.instances[0].emit('message', { data: JSON.stringify({ action: 'SOF_GetVersion', retValue: 'LATE' }) });
await sleep(50);
const lateOk = P0.log.some(l => l.kind === 'ws' && (l.tag === 'late-frame' || l.tag === undefined));
const notResolved = JSON.stringify(P0.log).indexOf('LATE') >= 0 && r2.retValue === 'a||c&&&';
check('T1-a4 旧帧只记录不误配（log 含 late-frame/LATE 记录且 r2 不变）', lateOk && notResolved);

// ── T1-b 队列失效：排队命令不跨连接续发 ──
FakeWS.script = [() => {}];
const q1 = P0.rawCall('SOF_GetVersion', []);
const q2 = P0.rawCall('SOF_GetUserList', []);       // 立即入队
await q1;                                            // 超时 → epoch++
let q2err = null;
try { await q2; } catch (e) { q2err = e; }
check('T1-b1 p2 拒绝且含 QUEUE_INVALIDATED', !!q2err && /QUEUE_INVALIDATED/.test(q2err.message));
check('T1-b2 SOF_GetUserList 从未发出', FakeWS.instances.every(i => !((i.lastSent || '') + '').includes('SOF_GetUserList')));

// ── T1-c 连接等待超时 ──
FakeWS.openDelay = 9000;
const tc0 = Date.now();
let cerr = null;
try { await P0.rawCall('SOF_GetVersion', []); } catch (e) { cerr = e; }
check('T1-c1 连接等待超时拒绝', !!cerr && /连接超时/.test(cerr.message));
check('T1-c2 耗时≈8s（非 9s open、非挂起）', Date.now() - tc0 >= 7500 && Date.now() - tc0 < 8900, (Date.now()-tc0)+'ms');
FakeWS.openDelay = 50;

// ── T1-d 打开前关闭不悬空 ──
FakeWS.closeBeforeOpen = true;
const td0 = Date.now();
let derr = null;
try { await P0.rawCall('SOF_GetVersion', []); } catch (e) { derr = e; }
check('T1-d1 打开前关闭立即 reject', !!derr && /打开前关闭/.test(derr.message));
check('T1-d2 快速返回（<2000ms）', Date.now() - td0 < 2000, (Date.now()-td0)+'ms');

console.log(results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\nT1: ${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
