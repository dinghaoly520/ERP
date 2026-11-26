# 开标实时通道「入会等握手鉴权完成」竞态修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端一连上开标实时通道就申请加入项目房间时，不再因为服务端还没完成身份校验而被误判为未授权；万一仍被拒，前端会重试。

**Architecture:** 服务端在 `bid.gateway.ts` 把异步的握手鉴权变成挂在连接上的 promise（在第一个 `await` 之前挂），入会处理先等它结束再读身份。前端四个门户的 hook 把入会申请改成带应答回调，未授权就重试；这部分逻辑放进每个门户一份的纯函数文件 `src/lib/ws-join.ts`，便于单测。

**Tech Stack:** NestJS 11 + Socket.IO 4.8（服务端）；React hook + socket.io-client 4.8（前端）；jest（API 单测与 e2e）；`node:test` + `node:assert/strict`（门户单测）。

**Spec:** `water-erp/docs/superpowers/specs/2026-11-25-bid-ws-join-auth-race-design.md`

## Global Constraints

- **鉴权口径不变**：不放宽任何握手校验；`join:project` 的应答格式、事件名都不变。
- **只改入会处理**：`leave:project` 等其他处理、通知网关、聊天网关都不动；不给 `socket.data` 引入完整类型（沿用现有 `as any` 写法）。
- **界面语义不变**：`connected` 状态的置位时机不变；入会因业务原因被拒不重试、不提示，只记一条 `console.warn`。
- **重试参数**：含首次最多 3 次，间隔 150ms → 300ms → 600ms，每次等应答最多 5000ms；重试耗尽（未授权或等不到应答）断开连接走既有重连；**连续 3 次连接**都入会失败则停止自动重连，状态停在 `disconnected`。
- **四份 `ws-join.ts` 逐字一致**（只有所在门户不同）；各 hook 入参、返回值、事件回调不变，页面调用方不改。`bid-portal` 今天不受影响，改它只为四份一致。
- **测试先行**：每个任务先写失败的测试、看到它失败，再写实现。
- **预期里的用例数是写计划时的实测基线**；动手时若别的会话已经改过测试，以「新增的用例全过、没有其他失败」为准。
- **命令一律绝对路径 `cd`**；跑测试直接用 `node_modules/.bin/jest` / `.bin/tsx` / `node --test`，**不经 pnpm**（`pnpm test` 会触发自动安装并失败）。
- **e2e 只能在隔离环境里跑**（附录 A）。直接在 `apps/api` 下跑 e2e 会连到 `.env` 指向的实时库。
- **单测与 e2e 都要在本机时区和 `TZ=UTC`（CI 的时区）下各跑一遍。**
- **提交纪律**（多会话共用工作区）：提交前 `git status --short` 确认只有本任务的文件；只对自己明确改动的路径做 pathspec 提交（`git commit -m … -- <路径…>`），不用 `git add -A`；提交信息加第二个 `-m "Co-Authored-By: Claude Code <noreply@anthropic.com>"`；不主动 push。
- 路径前缀：仓库根 `/home/asus/桌面/ERP`，工作区根 `/home/asus/桌面/ERP/water-erp`。

## Review Focus

1. **平板配对令牌的握手鉴权多一次 Redis 存活校验**，耗时更长——等待必须把它一并涵盖。钉在 Task 1 Step 8（现有配对单测与 `tab-sync-01-pairing` e2e 必须仍绿）。
2. **鉴权 promise 以异常结束**——等待方不得把异常抛给入会的调用者。钉在 Task 1 Step 1 的第 4 条用例「握手鉴权以异常结束时」。
3. **旧连接的迟到应答**（已重连或切项目）——不得断开新连接、不得改动失败计数。钉在 Task 2 Step 1 的用例「迟到的应答」。
4. **服务端一直不回应答**（鉴权挂起）——前端 5 秒后按失败处理并断开重连，而不是永远挂着。钉在 Task 2 Step 1 的用例「等不到应答」。
5. **会话确实失效**（被顶掉）——重试耗尽后连续 3 次连接失败即停止自动重连，不陷入无限重连。钉在 Task 2 Step 1 的用例「连续三次连接入会失败」。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/api/src/bid/bid.gateway.ts` | 修改 | 握手鉴权抽成方法并挂到连接上；入会先等它 |
| `apps/api/src/bid/bid.gateway.spec.ts` | 追加 | 网关时序单测 |
| `apps/api/test/opening-hall.e2e-spec.ts` | 追加一条用例 | 真实 socket 的回归 |
| `apps/web/src/lib/ws-join.ts` | 新建（基准版） | 入会重试与重试耗尽策略的纯函数 |
| `apps/web/src/lib/ws-join.test.ts` | 新建 | 纯函数单测 |
| `apps/web/src/hooks/use-bid-websocket.ts` | 修改 | 连接后改调纯函数 |
| `apps/supplier-portal-next/src/lib/ws-join.ts` + `src/lib/__tests__/ws-join.test.ts` | 新建 | 同上，逐字复制 |
| `apps/supplier-portal-next/src/hooks/use-bid-websocket.ts` | 修改 | 同上（该 hook 用闭包变量，接入写法略不同） |
| `apps/expert-portal/src/lib/ws-join.ts` + `src/lib/__tests__/ws-join.test.ts` | 新建 | 同上（测试由 Node 直接跑 TS） |
| `apps/expert-portal/src/hooks/use-expert-websocket.ts` | 修改 | 同上 |
| `apps/bid-portal/src/lib/ws-join.ts` | 新建 | 同上（无测试脚本，不加测试文件） |
| `apps/bid-portal/src/hooks/use-bid-websocket.ts` | 修改 | 同上 |
| `CLAUDE.md` | 修改 | 实时通道一节补一句约定 |

---

### Task 1: 服务端——入会先等握手鉴权完成

**Files:**
- Test: `apps/api/src/bid/bid.gateway.spec.ts`（文件末尾追加一组 `describe`）
- Test: `apps/api/test/opening-hall.e2e-spec.ts:276`（「成员门」用例之后追加一条 `it`）
- Modify: `apps/api/src/bid/bid.gateway.ts:195-288`（`handleConnection`）、`:378-383`（`handleJoinProject` 开头）

**Interfaces:**
- Produces（供本任务测试依赖，外部不可见）：
  - `private async authenticateHandshake(socket: Socket): Promise<void>`——握手鉴权主体，原 `handleConnection` 的内容原样搬入。
  - `private async awaitHandshakeAuth(client: Socket): Promise<void>`——入会前等待；没有凭证时直接返回。
  - 连接上的约定字段：`socket.data.authReady: Promise<void>`，在 `handleConnection` 的第一个 `await` 之前写入。

- [ ] **Step 1: 写失败的网关单测**

在 `apps/api/src/bid/bid.gateway.spec.ts` 末尾追加：

```ts
describe('握手鉴权与入会的时序（2026-11-25 入会竞态修复）', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const makeSocket = (cookie: string, portal: string) =>
    ({
      id: 'sock-race', data: {}, connected: true,
      handshake: { headers: { cookie, 'x-portal': portal }, query: {} },
      disconnect: jest.fn(), join: jest.fn(),
    }) as any;

  it('握手鉴权未完成时就到达的 join:project：等鉴权完成后再入会，不得判 UNAUTHORIZED', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockImplementation(async () => { await sleep(30); return { webSessionId: 'sid-1' }; }) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '甲公司' }),
        findMany: jest.fn().mockResolvedValue([]), // 入会后的在场广播会查
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r)); // 让出事件循环：真实客户端的入会消息总在之后一轮到达，此时查库对账还没结束
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ ok: true, supplierId: 'sup-1', supplierName: '甲公司' });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('握手鉴权失败（会话对账不匹配）：入会仍返回 UNAUTHORIZED，且连接被断开', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-other' }) },
      supplier: { findFirst: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), update: jest.fn() },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r));
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ error: 'UNAUTHORIZED' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('不带会话编号的主持人令牌：连上立即入会成功（行为不变）', async () => {
    const prisma = { user: { findUnique: jest.fn() }, bidProject: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-host', role: 'bid_host' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_bid=host-jwt', 'bid');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r)); // 验签只占一个微任务：让出事件循环后身份已就位（主持人本就不受这个竞态影响）
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ ok: true });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('握手鉴权以异常结束时：入会按身份缺失处理，不向外抛', async () => {
    const gw = new BidGateway({} as any, {} as any);
    const rejected = Promise.reject(new Error('boom'));
    rejected.catch(() => undefined); // 修复前不会被等待，先挂个处理函数避免未处理的拒绝干扰判定
    const client = { id: 'sock-x', data: { authReady: rejected }, join: jest.fn() } as any;
    await expect(gw.handleJoinProject(client, 'p1')).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });
});
```

- [ ] **Step 2: 运行单测，确认第一条失败**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && node_modules/.bin/jest src/bid/bid.gateway.spec.ts --forceExit`
Expected: `Tests: 1 failed, 3 passed, 59 total`（原有 55 条 + 新增 4 条）；失败的是「握手鉴权未完成时就到达…」，received 为 `{ error: 'UNAUTHORIZED' }`。

- [ ] **Step 3: 写失败的 e2e 用例**

在 `apps/api/test/opening-hall.e2e-spec.ts` 第 276 行（「成员门」用例的 `});`）之后追加：

```ts
  it('握手鉴权慢时，连上立即入会仍须成功（2026-11-25 入会等握手鉴权完成）', async () => {
    const original = prisma.user.findUnique.bind(prisma.user);
    const spy = jest.spyOn(prisma.user as any, 'findUnique')
      .mockImplementation(async (args: any) => { await new Promise((r) => setTimeout(r, 300)); return original(args); });
    try {
      const s = track(connectBid(base, sup1Cookie)); await connected(s);
      expect(await joinAck(s, projectId)).toEqual(expect.objectContaining({ ok: true, supplierId: sup1Id }));
    } finally {
      spy.mockRestore();
    }
  });
```

- [ ] **Step 4: 在隔离环境里跑该套件，确认新用例失败**

按附录 A 确认隔离环境可用，然后：
Run: `FRESH=1 /tmp/e2e-harness/run.sh test/opening-hall.e2e-spec.ts`
Expected: `Tests: 1 failed, 25 passed, 26 total`，失败的是新增用例，received 为 `{ error: 'UNAUTHORIZED' }`。

- [ ] **Step 5: 改 `bid.gateway.ts`——鉴权挂到连接上，入会先等它**

1. `handleConnection`（L195–288）改成下面三行加一个调用，**把现有主体原样搬进新方法** `private async authenticateHandshake(socket: Socket): Promise<void>`（无令牌、验签失败、载荷缺字段、会话对账失败、配对已失效各分支仍 `socket.disconnect(true)` 后 `return`；末尾写身份与配对字段、连接态跟踪、`logger.debug` 的语句也一并搬入）：

```ts
async handleConnection(socket: Socket) {
  // 入会可能在握手鉴权完成前到达（2026-11-25 竞态修复）：鉴权 promise 必须在本方法的
  // 第一个 await 之前挂到连接上——Nest 在 connection 事件里同步调用本方法，而 CONNECT 包
  // 刚写入、客户端的任何消息都要晚一轮事件循环才到，所以入会处理执行时它一定在。
  const authReady = this.authenticateHandshake(socket);
  (socket.data as any).authReady = authReady;
  await authReady;
}
```

2. `handleJoinProject`（L378）在方法开头的 `const role = …`（L379）**之前**加一行 `await this.awaitHandshakeAuth(client);`，并加一句注释：握手鉴权是异步的，入会申请可能先到，先等它落地。其余不动。

3. 新增：

```ts
private async awaitHandshakeAuth(client: Socket): Promise<void> {
  const ready = (client.data as any).authReady as Promise<void> | undefined;
  if (!ready) return; // 没有凭证（单测直构的连接对象）：维持原行为，由下方 C1 兜底判未授权
  try { await ready; } catch { /* 鉴权以异常结束时身份缺失，同样落到未授权分支 */ }
}
```

- [ ] **Step 6: 单测转绿（两个时区）**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && node_modules/.bin/jest src/bid/bid.gateway.spec.ts --forceExit`，再跑一遍前面加 `TZ=UTC` 的同样命令。
Expected: 两次都是 `Tests: 59 passed, 59 total`。

- [ ] **Step 7: e2e 转绿并确认套件不再抖动**

Run（空库重建后各跑两轮）: `/tmp/e2e-harness/rebuild.sh && /tmp/e2e-harness/run.sh test/opening-hall.e2e-spec.ts`；`/tmp/e2e-harness/rebuild.sh && TZ=UTC /tmp/e2e-harness/run.sh test/opening-hall.e2e-spec.ts`。
Expected: 每轮 `Tests: 26 passed, 26 total`，输出里没有 `UNAUTHORIZED`。

- [ ] **Step 8: 回归——配对相关与 bid 目录全部单测**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && node_modules/.bin/jest src/bid/ --forceExit`
Run: `/tmp/e2e-harness/rebuild.sh && /tmp/e2e-harness/run.sh test/tab-sync-01-pairing.e2e-spec.ts`
Expected: `src/bid/` 下全部通过（含 `bid.gateway.pairing.spec.ts`）；配对 e2e 全部通过。

- [ ] **Step 9: 提交**

```bash
cd /home/asus/桌面/ERP && git status --short   # 只应有下面三个文件
git commit -m "fix(bid-gateway): 入会先等握手鉴权完成——连接在第一个 await 之前挂上鉴权 promise，消除「一连上就入会被判 UNAUTHORIZED」的竞态" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" \
  -- water-erp/apps/api/src/bid/bid.gateway.ts water-erp/apps/api/src/bid/bid.gateway.spec.ts water-erp/apps/api/test/opening-hall.e2e-spec.ts
```

---

### Task 2: web——入会重试的纯函数与 hook 接入（基准版）

**Files:**
- Create: `apps/web/src/lib/ws-join.ts`
- Create: `apps/web/src/lib/ws-join.test.ts`
- Modify: `apps/web/src/hooks/use-bid-websocket.ts`（`connect` 回调里 `socket.emit('join:project', projectId)` 那一行，约 L127；`reconnectNow`，约 L202）

**Interfaces:**
- Produces（Task 3–5 逐字复制，签名不得改）：
  - `type JoinAck = { ok?: boolean; error?: string; [key: string]: unknown }`
  - `interface JoinProjectOptions { attempts?: number; baseDelayMs?: number; ackTimeoutMs?: number; isStale?: () => boolean; sleep?: (ms: number) => Promise<void> }`
  - `interface JoinPolicyDeps { isCurrent: () => boolean; getFailStreak: () => number; setFailStreak: (n: number) => void; stopReconnect: () => void }`
  - `const JOIN_MAX_CONSECUTIVE_FAILURES = 3`
  - `function joinProjectWithRetry(socket: Socket, projectId: string, options?: JoinProjectOptions): Promise<JoinAck>`
  - `function joinProjectOnConnect(socket: Socket, projectId: string, deps: JoinPolicyDeps, options?: JoinProjectOptions): Promise<void>`

- [ ] **Step 1: 写失败的纯函数单测**

新建 `apps/web/src/lib/ws-join.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import { joinProjectOnConnect, joinProjectWithRetry } from "./ws-join.ts";

const U = { error: "UNAUTHORIZED" };
const noWait = async () => {};

/** 假连接：按顺序回给定的应答；队列空了就不回（模拟服务端不应答） */
function fakeSocket(acks: unknown[]) {
  const emitted: string[] = [];
  const socket = {
    emit(event: string, _projectId: string, ack?: (a: unknown) => void) {
      emitted.push(event);
      const next = acks.shift();
      if (next === undefined) return;
      setTimeout(() => ack?.(next), 0);
    },
    disconnect: () => { emitted.push("disconnect"); },
  } as unknown as Socket;
  return { socket, emitted };
}

/** 策略依赖与可观测的内部状态 */
function deps() {
  const state = { streak: 0, stopped: 0, gets: 0, sets: 0, current: true };
  const d = {
    isCurrent: () => state.current,
    getFailStreak: () => { state.gets++; return state.streak; },
    setFailStreak: (n: number) => { state.sets++; state.streak = n; },
    stopReconnect: () => { state.stopped++; },
  };
  return { d, state };
}

test("未授权两次后成功：共发三次，返回成功", async () => {
  const { socket, emitted } = fakeSocket([U, U, { ok: true }]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), { ok: true });
  assert.equal(emitted.length, 3);
});

test("一直未授权：发满三次后原样返回 UNAUTHORIZED", async () => {
  const { socket, emitted } = fakeSocket([U, U, U]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), U);
  assert.equal(emitted.length, 3);
});

test("重试间隔逐次翻倍：150 → 300", async () => {
  const waits: number[] = [];
  const { socket } = fakeSocket([U, U, { ok: true }]);
  await joinProjectWithRetry(socket, "p1", { sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [150, 300]);
});

test("业务性拒绝不重试", async () => {
  const { socket, emitted } = fakeSocket([{ error: "NOT_PROJECT_MEMBER" }]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait }), { error: "NOT_PROJECT_MEMBER" });
  assert.equal(emitted.length, 1);
});

test("等不到应答：返回 JOIN_TIMEOUT 且不重试", async () => {
  const { socket, emitted } = fakeSocket([]);
  assert.deepEqual(await joinProjectWithRetry(socket, "p1", { sleep: noWait, ackTimeoutMs: 5 }), { error: "JOIN_TIMEOUT" });
  assert.equal(emitted.length, 1);
});

test("连接已作废：停止重发", async () => {
  let stale = false;
  const { socket, emitted } = fakeSocket([U, { ok: true }]);
  const ack = await joinProjectWithRetry(socket, "p1", { sleep: async () => { stale = true; }, isStale: () => stale });
  assert.deepEqual(ack, { error: "JOIN_ABORTED" });
  assert.equal(emitted.length, 1);
});

test("入会成功：失败计数清零，不断开", async () => {
  const { socket, emitted } = fakeSocket([U, { ok: true }]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.deepEqual(emitted, ["join:project", "join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 1, current: true });
});

test("重试耗尽：断开连接，失败次数记为 1", async () => {
  const { socket, emitted } = fakeSocket([U, U, U]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.equal(emitted[emitted.length - 1], "disconnect");
  assert.deepEqual(state, { streak: 1, stopped: 0, gets: 1, sets: 1, current: true });
});

test("连续三次连接入会失败：第三次时要求停止重连并断开", async () => {
  const { d, state } = deps();
  for (let i = 1; i <= 3; i++) {
    const { socket, emitted } = fakeSocket([U, U, U]);
    await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
    assert.equal(state.streak, i);
    assert.equal(state.stopped, i >= 3 ? 1 : 0);
    assert.equal(emitted[emitted.length - 1], "disconnect");
  }
});

test("迟到的应答（连接已被替换）：不改动任何状态、不断开", async () => {
  const { socket, emitted } = fakeSocket([{ ok: true }]);
  const { d, state } = deps();
  const pending = joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  state.current = false; // 应答回来之前连接已被替换
  await pending;
  assert.deepEqual(emitted, ["join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: false });
});

test("业务性拒绝：不重试、不断开、不计失败", async () => {
  const { socket, emitted } = fakeSocket([{ error: "NOT_PROJECT_MEMBER" }]);
  const { d, state } = deps();
  await joinProjectOnConnect(socket, "p1", d, { sleep: noWait });
  assert.deepEqual(emitted, ["join:project"]);
  assert.deepEqual(state, { streak: 0, stopped: 0, gets: 0, sets: 0, current: true });
});
```

- [ ] **Step 2: 运行测试，确认因缺少模块而失败**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/web && node_modules/.bin/tsx --test "src/**/*.test.ts"`
Expected: `fail 1`，报找不到 `./ws-join.ts`。

- [ ] **Step 3: 新建 `apps/web/src/lib/ws-join.ts`（基准版）**

```ts
import type { Socket } from 'socket.io-client';

/** join:project 的应答：成功为 { ok: true, … }，被拒为 { error: <原因> } */
export interface JoinAck {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface JoinProjectOptions {
  /** 含首次在内最多发几次 */
  attempts?: number;
  /** 首次重试前的等待毫秒数，逐次翻倍 */
  baseDelayMs?: number;
  /** 每次等应答的毫秒数 */
  ackTimeoutMs?: number;
  /** 返回 true 表示这条连接已不是当前连接（重连 / 切项目 / 手动关闭），立即停止 */
  isStale?: () => boolean;
  /** 等待函数，测试里替换成立即完成 */
  sleep?: (ms: number) => Promise<void>;
}

/** hook 侧策略需要的上下文 */
export interface JoinPolicyDeps {
  /** 这条连接是否仍是当前连接 */
  isCurrent: () => boolean;
  /** 连续入会失败次数（跨重连累计，成功清零） */
  getFailStreak: () => number;
  setFailStreak: (n: number) => void;
  /** 停止自动重连 */
  stopReconnect: () => void;
}

/** 连续这么多次连接都没能入会，就停止自动重连 */
export const JOIN_MAX_CONSECUTIVE_FAILURES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function emitOnce(socket: Socket, projectId: string, ackTimeoutMs: number): Promise<JoinAck> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ error: 'JOIN_TIMEOUT' }); }
    }, ackTimeoutMs);
    socket.emit('join:project', projectId, (ack: JoinAck | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack ?? { error: 'JOIN_TIMEOUT' });
    });
  });
}

/**
 * 加入项目房间；应答为 UNAUTHORIZED 时重试（2026-11-25 入会竞态修复）。
 * UNAUTHORIZED 多半是入会申请比服务端的握手鉴权先到——稍后重发即可成功。
 * 其他应答（成功或业务性拒绝）原样返回，不重试。
 */
export async function joinProjectWithRetry(socket: Socket, projectId: string, options: JoinProjectOptions = {}): Promise<JoinAck> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;
  const ackTimeoutMs = options.ackTimeoutMs ?? 5000;
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.isStale?.()) return { error: 'JOIN_ABORTED' };
    const ack = await emitOnce(socket, projectId, ackTimeoutMs);
    if (ack.error !== 'UNAUTHORIZED' || attempt === attempts - 1) return ack;
    await wait(baseDelayMs * 2 ** attempt);
  }
  return { error: 'JOIN_ABORTED' }; // 循环内必然已返回，这里只为类型完整
}

/** hook 在连接成功后调用：入会、必要时重试，并按结果决定是否断开重连 */
export async function joinProjectOnConnect(socket: Socket, projectId: string, deps: JoinPolicyDeps, options: JoinProjectOptions = {}): Promise<void> {
  const ack = await joinProjectWithRetry(socket, projectId, { ...options, isStale: () => !deps.isCurrent() });
  if (!deps.isCurrent()) return; // 迟到的应答：连接已被替换，结果作废
  if (ack.ok) { deps.setFailStreak(0); return; }
  if (ack.error === 'UNAUTHORIZED' || ack.error === 'JOIN_TIMEOUT') {
    const streak = deps.getFailStreak() + 1;
    deps.setFailStreak(streak);
    if (streak >= JOIN_MAX_CONSECUTIVE_FAILURES) deps.stopReconnect();
    socket.disconnect(); // 走 hook 既有的 disconnect → 重连路径
    return;
  }
  console.warn('[ws] join:project 被拒', ack.error);
}
```

- [ ] **Step 4: 测试转绿**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/web && node_modules/.bin/tsx --test "src/**/*.test.ts"`，再跑一遍前面加 `TZ=UTC` 的同样命令。
Expected: 两次都是 `tests 145 / pass 141 / fail 0 / skipped 4`（原 134 条加 11 条）。

- [ ] **Step 5: hook 接入**

`apps/web/src/hooks/use-bid-websocket.ts`：

1. 顶部引入 `import { joinProjectOnConnect } from '../lib/ws-join';`。
2. `const manualClose = useRef(false);`（约 L90）的下一行加 `const joinFailStreak = useRef(0);`，行尾注释「连续几次连接都没能入会（重连会重置 attempt，须单独计数）」。
3. `connect` 回调里 `socket.emit('join:project', projectId);`（约 L127）那一行换成下面这段；其余各行（置 `connected`、重连刷新、心跳）顺序不变：

```ts
      void joinProjectOnConnect(socket, projectId, {
        isCurrent: () => socketRef.current === socket && !manualClose.current,
        getFailStreak: () => joinFailStreak.current,
        setFailStreak: (n) => { joinFailStreak.current = n; },
        stopReconnect: () => { manualClose.current = true; },
      });
```

4. `reconnectNow` 里 `attemptRef.current = 0;` 之后加 `joinFailStreak.current = 0;`。

- [ ] **Step 6: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp && apps/web/node_modules/.bin/tsc --noEmit -p apps/web --tsBuildInfoFile /tmp/ws-join-web.tsbuildinfo`
Expected: 无输出，退出码 0。

- [ ] **Step 7: 提交**

```bash
cd /home/asus/桌面/ERP && git status --short   # 只应有下面三个文件
git commit -m "fix(web): 入会带应答并对未授权重试——纯函数 ws-join + 开标实时 hook 接入（入会竞态修复前端侧）" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" \
  -- water-erp/apps/web/src/lib/ws-join.ts water-erp/apps/web/src/lib/ws-join.test.ts water-erp/apps/web/src/hooks/use-bid-websocket.ts
```

---

### Task 3: supplier-portal-next——同款

**Files:**
- Create: `apps/supplier-portal-next/src/lib/ws-join.ts`（与 Task 2 的 `ws-join.ts` 逐字一致）
- Create: `apps/supplier-portal-next/src/lib/__tests__/ws-join.test.ts`（内容同 Task 2 Step 1，仅引入路径为 `"../ws-join.ts"`）
- Modify: `apps/supplier-portal-next/src/hooks/use-bid-websocket.ts`（`connect()` 里 `s.emit("join:project", projectId);` 那一行，约 L97）

**Interfaces:**
- Consumes: Task 2 的 `joinProjectOnConnect(socket, projectId, deps: JoinPolicyDeps, options?)`。

- [ ] **Step 1: 写测试并确认失败**

新建测试文件（内容同 Task 2 Step 1，第三行引入改为 `from "../ws-join.ts"`）。
Run: `cd /home/asus/桌面/ERP/water-erp/apps/supplier-portal-next && node_modules/.bin/tsx --test "src/lib/__tests__/ws-join.test.ts"`
Expected: 报找不到 `../ws-join.ts`。

- [ ] **Step 2: 复制纯函数文件，测试转绿**

Run: `cd /home/asus/桌面/ERP/water-erp && cp apps/web/src/lib/ws-join.ts apps/supplier-portal-next/src/lib/ws-join.ts`
Run: `cd /home/asus/桌面/ERP/water-erp/apps/supplier-portal-next && node_modules/.bin/tsx --test "src/lib/__tests__/ws-join.test.ts"`，再跑一遍前面加 `TZ=UTC` 的同样命令。
Expected: 两次都是 `tests 11 / pass 11 / fail 0`。

- [ ] **Step 3: hook 接入（该 hook 用闭包变量）**

`apps/supplier-portal-next/src/hooks/use-bid-websocket.ts`：

1. 引入 `joinProjectOnConnect`（路径 `../lib/ws-join`）。
2. `connect()` 开头的 `if (disposed || sessionStopped || socket?.connected) return;` 改成 `if (!projectId || disposed || sessionStopped || socket?.connected) return;`——让 `projectId` 在函数内收窄为字符串，否则第 4 点的调用编译不过；行为不变（外层 effect 在 `projectId` 为空时本就不会走到这里）。
3. `let hasConnectedOnce = false; // X-P2-09…`（约 L61）的下一行加 `let joinFailStreak = 0; // 连续几次连接都没能入会`（`reconnectNow` 会重跑整个 effect，该变量自然归零）。
4. `connect()` 里 `s.emit("join:project", projectId);`（约 L97）那一行换成下面这段；其余各行顺序不变：

```ts
        void joinProjectOnConnect(s, projectId, {
          isCurrent: () => socket === s && !manualClose && !disposed,
          getFailStreak: () => joinFailStreak,
          setFailStreak: (n) => { joinFailStreak = n; },
          stopReconnect: () => { manualClose = true; },
        });
```

- [ ] **Step 4: 类型检查与该门户全部单测**

Run: `cd /home/asus/桌面/ERP/water-erp && apps/supplier-portal-next/node_modules/.bin/tsc --noEmit -p apps/supplier-portal-next --tsBuildInfoFile /tmp/ws-join-supplier.tsbuildinfo`
Run: `cd /home/asus/桌面/ERP/water-erp/apps/supplier-portal-next && node_modules/.bin/tsx --test "src/lib/__tests__/*.test.ts" "src/components/__tests__/*.test.tsx" "src/utils/__tests__/*.test.ts"`
Expected: tsc 退出码 0；单测 `tests 274 / pass 274 / fail 0`（原 263 条加 11 条）。

- [ ] **Step 5: 提交**

```bash
cd /home/asus/桌面/ERP && git status --short   # 只应有下面三个文件
git commit -m "fix(supplier): 开标实时 hook 入会带应答并对未授权重试（入会竞态修复前端侧）" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" \
  -- water-erp/apps/supplier-portal-next/src/lib/ws-join.ts water-erp/apps/supplier-portal-next/src/lib/__tests__/ws-join.test.ts water-erp/apps/supplier-portal-next/src/hooks/use-bid-websocket.ts
```

---

### Task 4: expert-portal——同款（测试由 Node 直接跑 TypeScript）

**Files:**
- Create: `apps/expert-portal/src/lib/ws-join.ts`（与 Task 2 的 `ws-join.ts` 逐字一致）
- Create: `apps/expert-portal/src/lib/__tests__/ws-join.test.ts`（内容同 Task 2 Step 1；前两行照该目录现有文件的写法 `import { test } from 'node:test';`、`import assert from 'node:assert/strict';`，引入 `'../ws-join.ts'`）
- Modify: `apps/expert-portal/src/hooks/use-expert-websocket.ts`（`connect` 回调里 `socket.emit('join:project', projectId);` 那一行，约 L111；`reconnectNow`，约 L157）

**Interfaces:**
- Consumes: Task 2 的 `joinProjectOnConnect` 与 `JoinPolicyDeps`。

- [ ] **Step 1: 写测试并确认失败**

新建测试文件。
Run: `cd /home/asus/桌面/ERP/water-erp/apps/expert-portal && node --test src/lib/__tests__/ws-join.test.ts`
Expected: 报找不到 `../ws-join.ts`。

- [ ] **Step 2: 复制纯函数文件，测试转绿**

Run: `cd /home/asus/桌面/ERP/water-erp && cp apps/web/src/lib/ws-join.ts apps/expert-portal/src/lib/ws-join.ts`
Run: `cd /home/asus/桌面/ERP/water-erp/apps/expert-portal && node --test src/lib/__tests__/ws-join.test.ts`，再跑一遍前面加 `TZ=UTC` 的同样命令。
Expected: 两次都是 `tests 11 / pass 11 / fail 0`。若报语法类错误，说明 `ws-join.ts` 用到了需要转译的写法（枚举、命名空间、参数属性）——回到 Task 2 改基准文件，并把改动同步到已复制的门户。

- [ ] **Step 3: hook 接入**

`apps/expert-portal/src/hooks/use-expert-websocket.ts`：

1. 引入 `joinProjectOnConnect`。
2. `const manualClose = useRef(false);`（约 L53）的下一行加 `const joinFailStreak = useRef(0);`（注释同 Task 2 Step 5 第 2 点）。
3. `connect` 回调里 `socket.emit('join:project', projectId);`（约 L111）那一行换成 Task 2 Step 5 第 3 点的那段代码（逐字相同，缩进随该处调整）。
4. `reconnectNow` 里 `attemptRef.current = 0;` 之后加 `joinFailStreak.current = 0;`。

- [ ] **Step 4: 类型检查与该门户全部单测**

Run: `cd /home/asus/桌面/ERP/water-erp && apps/expert-portal/node_modules/.bin/tsc --noEmit -p apps/expert-portal --tsBuildInfoFile /tmp/ws-join-expert.tsbuildinfo`
Run: `cd /home/asus/桌面/ERP/water-erp/apps/expert-portal && node --test src/lib/__tests__/*.test.ts`
Expected: tsc 退出码 0；单测 `tests 70 / pass 70 / fail 0`（原 59 条加 11 条）。

- [ ] **Step 5: 提交**

```bash
cd /home/asus/桌面/ERP && git status --short   # 只应有下面三个文件
git commit -m "fix(expert): 开标实时 hook 入会带应答并对未授权重试（入会竞态修复前端侧）" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" \
  -- water-erp/apps/expert-portal/src/lib/ws-join.ts water-erp/apps/expert-portal/src/lib/__tests__/ws-join.test.ts water-erp/apps/expert-portal/src/hooks/use-expert-websocket.ts
```

---

### Task 5: bid-portal——同款（无测试脚本）

**Files:**
- Create: `apps/bid-portal/src/lib/ws-join.ts`（与 Task 2 的 `ws-join.ts` 逐字一致）
- Modify: `apps/bid-portal/src/hooks/use-bid-websocket.ts`（`connect` 回调里 `socket.emit('join:project', projectId);` 那一行，约 L132；`reconnectNow`，约 L205）

**Interfaces:**
- Consumes: Task 2 的 `joinProjectOnConnect` 与 `JoinPolicyDeps`。

说明：该门户今天的登录令牌不带会话编号，不受这个漏洞影响；这次改它只为四份 hook 一致。门户没有测试脚本，所以不加测试文件，靠与基准文件逐字一致和类型检查保证。

- [ ] **Step 1: 复制纯函数文件并核对一致**

Run: `cd /home/asus/桌面/ERP/water-erp && cp apps/web/src/lib/ws-join.ts apps/bid-portal/src/lib/ws-join.ts && diff apps/web/src/lib/ws-join.ts apps/bid-portal/src/lib/ws-join.ts && echo identical`
Expected: 输出 `identical`。

- [ ] **Step 2: hook 接入**

`apps/bid-portal/src/hooks/use-bid-websocket.ts`：

1. 引入 `joinProjectOnConnect`。
2. `const manualClose = useRef(false);`（约 L90）的下一行加 `const joinFailStreak = useRef(0);`。
3. `connect` 回调里 `socket.emit('join:project', projectId);`（约 L132）那一行换成 Task 2 Step 5 第 3 点的那段代码（逐字相同）。
4. `reconnectNow` 里 `attemptRef.current = 0;` 之后加 `joinFailStreak.current = 0;`。

- [ ] **Step 3: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp && apps/bid-portal/node_modules/.bin/tsc --noEmit -p apps/bid-portal --tsBuildInfoFile /tmp/ws-join-bid.tsbuildinfo`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
cd /home/asus/桌面/ERP && git status --short   # 只应有下面两个文件
git commit -m "fix(bid): 开标实时 hook 入会带应答并对未授权重试——与 web 版双向同步（该门户令牌无会话编号，本就不受影响）" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" \
  -- water-erp/apps/bid-portal/src/lib/ws-join.ts water-erp/apps/bid-portal/src/hooks/use-bid-websocket.ts
```

---

### Task 6: 文档约定与整体验收

**Files:**
- Modify: `CLAUDE.md`（「WebSocket / Real-Time」一节）

**Interfaces:**
- Consumes: Task 1–5 的全部产出。

- [ ] **Step 1: 全量回归——API**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && node_modules/.bin/jest --forceExit`，再跑一遍前面加 `TZ=UTC` 的同样命令。
Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api exec eslint "src/**/*.ts" "test/**/*.ts"`
Run: `cd /home/asus/桌面/ERP/water-erp && bash scripts/check-cgzxui-redcards.sh --ci && bash scripts/copy-lint.sh --ci`
Expected: API 单测两个时区都全过，且用例数比动手前多 4 条（写计划时的基线是 `355` 套件 / `4958` 条，即应为 `4962` 条）；lint 0 错误；两道闸通过。

- [ ] **Step 2: 全量 e2e（空库重建，两个时区各两轮）**

Run: `/tmp/e2e-harness/rebuild.sh && /tmp/e2e-harness/run.sh`；`/tmp/e2e-harness/rebuild.sh && TZ=UTC /tmp/e2e-harness/run.sh`；再各重复一次。
Expected: 每轮 `Test Suites: 26 passed, 26 total`、`Tests: 225 passed, 225 total`（修前 224，加 Task 1 新增的 1 条），输出里没有 `UNAUTHORIZED`。

- [ ] **Step 3: 四份纯函数一致、四门户类型检查与单测**

Run: `cd /home/asus/桌面/ERP/water-erp && for a in supplier-portal-next expert-portal bid-portal; do diff -q apps/web/src/lib/ws-join.ts apps/$a/src/lib/ws-join.ts; done`，以及 Task 2–5 各自的类型检查与单测命令。
Expected: 三条 `diff` 都无输出；全部通过。

- [ ] **Step 4: 在 `CLAUDE.md` 补约定（用 Bash 改，单独提交）**

先 `git status --short` 确认工作区没有别人的未提交改动。在「WebSocket / Real-Time」一节里，以 ``The API uses `@nestjs/websockets` + Socket.IO`` 开头的那一段（按文字定位，行号会随别的改动漂移）之后插入一个空行和下面这段：

```markdown
**握手鉴权与入会时序（2026-11-25）**：`bid.gateway.ts` 的 `handleConnection` 是异步鉴权（验签；带会话编号的令牌还要查库对账），而客户端一收到 connect 就会发 `join:project`。连接一开始（第一个 `await` 之前）把鉴权 promise 挂到 `socket.data.authReady`，`handleJoinProject` 先 `await this.awaitHandshakeAuth(client)` 再读身份——**新增「连接后立刻可能到达」的消息处理必须同样先等它**，否则会被判 UNAUTHORIZED，而且是静默的：连接不断、界面仍显示已连接、却收不到项目房事件。前端四门户 hook 的入会带应答并对 UNAUTHORIZED 重试（各门户 `src/lib/ws-join.ts`，四份逐字一致）。主持人 `token_bid` 不带会话编号、握手不查库，本就不受影响；通知与聊天网关不靠客户端入会，不在此约束内。
```

做法：用 Bash 调 Python——读入 `CLAUDE.md`，找到以 ``The API uses `@nestjs/websockets` + Socket.IO`` 开头的那一行，在其后插入一个空行和上面这段，写回；`git diff --stat CLAUDE.md` 应只多出这几行。（`CLAUDE.md` 用编辑工具改会被本机守卫拦下，所以走 Bash。）

```bash
cd /home/asus/桌面/ERP && git status --short   # 应只有 CLAUDE.md
git commit -m "docs(claude): 实时通道握手鉴权与入会时序约定（新增连接后即到的消息处理须先等鉴权）" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>" -- CLAUDE.md
```

- [ ] **Step 5: 汇报，等待用户推送**

不主动 push。汇报各任务提交号、两个时区的全量 e2e 轮次结果、本地领先远端的提交数。用户说 push 后盯 CI 到终态——`validate` 与 `e2e` 两个作业都应 success（本机查法：先 `export HTTPS_PROXY=socks5://127.0.0.1:7897`，`gh run list --repo dinghaoly520/ERP --limit 3 --json databaseId,headSha,status,conclusion`，轮询到 `completed`）。

---

## 审查记录（2026-11-25，对照当前代码）

把计划里的代码块原样抽出来对当前代码实跑，发现并已在上面改正三处：

1. 网关单测原先在同一个同步调用栈里紧接着连接触理就调入会，连「主持人令牌」那条也会失败，与计划声称的「修复前已绿」不符。真实客户端的入会消息至少晚一轮事件循环，三条用例都改成先让出事件循环再入会；改后实测 1 条失败、3 条通过。
2. 供应商门户 hook 的 `connect()` 没有对 `projectId` 判空，原样接入编译不过（`string | undefined`）。Task 3 增加了把判空并入开头守卫的一步。
3. API 全量单测的基线已被别的会话改过（`353` / `4916` → `355` / `4958`），预期改为相对表述。

其余实测无问题：前端基准文件与 11 条单测在 tsx 与纯 Node 下都通过；e2e 新用例按原样插进 `opening-hall` 套件副本，连续 3 次稳定失败于未授权；四个 hook 的改动点都精确命中，web、expert-portal、bid-portal 三处接入编译通过，supplier-portal-next 在第 2 点修正后编译通过。

## 执行记录（2026-11-26，独立审查与真浏览器走查）

用户要求「独立审查然后在真浏览器里走一遍」。全新上下文的审查员（审查包 `1c199f8e8..08c3a33ea`）结论「可合并」，无 Critical；Important 1 条、Minor 5 条。方案甲的前提经审查员实验复核成立：握手鉴权放慢到 300ms 时修复后 10/10 入会成功、修复前 10/10 未授权。

### Important：会话真正失效后无限重连（已修，`138309c66` + `c8a6b9d84`）

- **现象**：会话被顶、登出或冻结后，服务端在握手鉴权里直接断开连接、不给入会应答（Nest 适配器对已断开的连接丢弃应答）。hook 只从应答里计失败，这条路径上的失败看不到；每次 connect 又把重连退避归零——页面开着的时候每秒重连、不停。本计划 Review Focus 第 5 条想防的正是它，原用例喂的是服务端实际给不出的未授权应答。
- **修法**：`ws-join.ts`（四份逐字一致）里 `joinProjectOnConnect` 返回「这条连接是否入会成功」，新增 `onDisconnectedBeforeJoin`——断开的是从未入会的连接就记一次失败，连续 3 次要求停止自动重连；客户端自己断开的不计。四个 hook 在 connect 与 disconnect 两处共用同一份失败计数。
- **不看断开原因的字样**：本机实测服务端断开时客户端每次都收到命名空间断开包，但轮询传输下这个包可能与连接关闭同批到达，按字样筛会漏。
- **代价**：停止后没有自动恢复。数据库或 Redis 不可用超过约 3 秒时，已打开的页面会停在「已断开」，服务恢复后要切回标签页或手动重连；工作台面板此时照常按 30 秒轮询取数。
- **证据**：三份单测各新增 10 条，均先红后绿，21/21；套件 web 155、supplier 284、expert 80 全过（两个时区）；四个门户 tsc 0 错误；红牌闸、文案闸通过。真浏览器（系统 Chrome、真实登录）：修复前会话被顶后 20 秒连了 20 次、观察结束仍在连；修复后 0.0 / 1.1 / 2.1 秒连 3 次后不再连。

### 真浏览器走查结论

四个门户各走「真实传输」与三条改写轮询应答的模拟路径（前两次未授权后成功、服务端不应答、一直未授权），修复前后都符合预期。真实传输入会耗时 4–104ms；:3007 上第二客户端入会后本项目收到 `hall:presence:update`；不应答 5 秒后按失败处理、重连后约 6 秒拿到应答；一直未授权每条连接发满 3 次后停止自动重连。工作台项目无其他参与者，未做第二客户端；专家门户没有可用的重连触发方式，「会话被顶」场景只验证了入会三条路径。

### 延后的次要项（未改，等用户定）

1. 入会处理途中客户端断开会留下常驻「在线」登记（服务端登记前不判连接是否仍在）。
2. 测试缺口：没有用例钉住「鉴权 promise 在 handleConnection 返回后同步可等」；平板配对令牌放慢 Redis 校验没有单测。
3. web / bid / expert 三个 hook 切项目时不清入会失败计数。
4. 平板评标页不消费连接状态，停止重连后没有提示。
5. `bid.gateway.ts` 里一句注释仍写「handleConnection 保持软鉴权」，已过时。

走查中顺带发现两处与本计划无关的接口 400：工作台打开项目详情时 `/api/drafts/supplier-confirm-threshold`（前端草稿键不在后端白名单里，`c7e5af456` 引入）；专家评标页 `/api/expert/projects/:id/esign-payload`。

---

## 附录 A：隔离 e2e 环境

e2e 在测试进程里直接启动应用，连哪个库取决于进程读到的 `.env`。不隔离会连到 `apps/api/.env` 指向的实时库并写数据。若 `/tmp/e2e-harness/` 下已有这五个文件，直接用；否则按下面原样重建（`mkdir -p /tmp/e2e-harness/prisma-cli`，五个脚本 `chmod +x`）。

**前提**：docker 容器 `water-erp-postgres`（pgvector pg16，`localhost:5432`）在跑；执行 `docker run -d --name water-erp-redis-e2e -p 6390:6379 redis:7-alpine`（已存在则跳过）；本机允许非特权用户命名空间（`sysctl kernel.apparmor_restrict_unprivileged_userns` 为 0）。

**`/tmp/e2e-harness/env.e2e`**（与 CI 的精简 `.env` 同构，库、Redis、桶换成隔离值；两个密钥库指到 /tmp，免得测试写开发密钥库）：

```
DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e
DIRECT_URL=postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e
JWT_SECRET=ci-dummy-jwt-secret-0123456789abcdef0123456789abcdef
SMS_DEBUG_BYPASS=true
SMS_PROVIDER=console
REDIS_URL=redis://localhost:6390
KMS_SECRET=ci-dummy-kms-secret-0123456789abcdef0123456789
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_ACCESS_KEY=water_erp_minio
MINIO_SECRET_KEY=water_erp_minio_dev
MINIO_BUCKET=water-erp-e2e
ADMIN_KEYSTORE_DIR=/tmp/e2e-harness/admin-keystore
SUPERVISION_KEYSTORE_DIR=/tmp/e2e-harness/supervision-keystore
TRUSTED_CA_DIR=/tmp/e2e-harness/trusted-ca
```

**`/tmp/e2e-harness/ns.sh`**（在私有挂载命名空间里用 e2e 的 env 覆盖 `apps/api/.env`，再在 `apps/api` 下执行给定命令；守卫不过就拒绝启动）：

```bash
#!/usr/bin/env bash
set -euo pipefail
H=/tmp/e2e-harness; API=/home/asus/桌面/ERP/water-erp/apps/api; ENV_FILE=$H/env.e2e
fail() { echo "GUARD FAIL: $*" >&2; exit 1; }
/usr/bin/grep -qE '^DATABASE_URL=postgresql://[^@]+@localhost:5432/water_erp_e2e$' "$ENV_FILE" || fail DATABASE_URL
/usr/bin/grep -qE '^DIRECT_URL=postgresql://[^@]+@localhost:5432/water_erp_e2e$' "$ENV_FILE" || fail DIRECT_URL
/usr/bin/grep -qE '^REDIS_URL=redis://localhost:6390$' "$ENV_FILE" || fail REDIS_URL
/usr/bin/grep -qE '^MINIO_BUCKET=water-erp-e2e$' "$ENV_FILE" || fail MINIO_BUCKET
! /usr/bin/grep -qE '54321|6432|6380|kingbase|ssycdb|/water_erp$' "$ENV_FILE" || fail "env file references a live/dev resource"
mkdir -p "$H/admin-keystore" "$H/supervision-keystore" "$H/trusted-ca"
exec unshare -Urm bash -c 'set -e; mount --bind "$1" "$2"; cd "$3"; shift 3; exec "$@"' _ "$ENV_FILE" "$API/.env" "$API" "$@"
```

**`/tmp/e2e-harness/fresh.sh`**（重灌种子；先让库自报名字，不是 `water_erp_e2e` 就拒绝）：

```bash
#!/usr/bin/env bash
set -uo pipefail
H=/tmp/e2e-harness; API=/home/asus/桌面/ERP/water-erp/apps/api
E2E_URL1="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e?connection_limit=1"
DBNAME=$(cd "$API" && DATABASE_URL="$E2E_URL1" "$H/ns.sh" ./node_modules/.bin/tsx --env-file=.env -e '
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
p.$queryRawUnsafe("SELECT current_database() AS db").then((r: any) => { console.log("PRECHECK " + r[0].db); }).finally(() => p.$disconnect());
' 2>&1 | /usr/bin/grep -E '^PRECHECK' | head -n 1)
[ "$DBNAME" = "PRECHECK water_erp_e2e" ] || { echo "REFUSE: current_database() is not water_erp_e2e"; exit 1; }
docker exec water-erp-redis-e2e redis-cli flushall >/dev/null
cd "$API" && DATABASE_URL="$E2E_URL1" DIRECT_URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e" "$H/ns.sh" ./node_modules/.bin/tsx --env-file=.env prisma/seed.ts > "$H/seed-last.log" 2>&1
/usr/bin/grep -q 'Seed 完成' "$H/seed-last.log" || { echo "fresh: SEED FAILED"; exit 1; }
echo "fresh: seeded $(date '+%T')"
```

**`/tmp/e2e-harness/run.sh`**（跑指定 e2e 文件；`FRESH=1` 时先重灌）：

```bash
#!/usr/bin/env bash
set -uo pipefail
H=/tmp/e2e-harness; API=/home/asus/桌面/ERP/water-erp/apps/api
[ "${FRESH:-0}" = 1 ] && "$H/fresh.sh"
LOG="$H/run-$(date +%H%M%S).log"
cd "$API" && "$H/ns.sh" ./node_modules/.bin/jest --config test/jest-e2e.json --forceExit "$@" > "$LOG" 2>&1; RC=$?
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" > "$LOG.clean"
echo "jest exit=$RC  $(/usr/bin/grep -E '^Test Suites:|^Tests:' "$LOG.clean" | tr '\n' ' ')  log=$LOG"
/usr/bin/grep -E '^\s+● ' "$LOG.clean" | sed -E 's/^\s+//' | sort -u | /usr/bin/grep -v '^● Console' | cut -c1-200
exit $RC
```

**`/tmp/e2e-harness/rebuild.sh`**（删库、按当前仓库的 schema 迁移、重灌；出正式结论前用）：

```bash
#!/usr/bin/env bash
set -uo pipefail
H=/tmp/e2e-harness; API=/home/asus/桌面/ERP/water-erp/apps/api
E2E_URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e"
docker exec water-erp-postgres psql -U water_erp -d postgres -c "DROP DATABASE IF EXISTS water_erp_e2e WITH (FORCE)" -c "CREATE DATABASE water_erp_e2e" > /dev/null 2>&1 || { echo "REBUILD FAILED: drop/create"; exit 1; }
T=$H/prisma-cli; rm -rf "$T"; mkdir -p "$T/prisma"
cp "$API/prisma/schema.prisma" "$T/prisma/schema.prisma"; ln -sfn "$API/prisma/migrations" "$T/prisma/migrations"
cd "$T"
DATABASE_URL="$E2E_URL" DIRECT_URL="$E2E_URL" "$API/node_modules/.bin/prisma" migrate status --schema prisma/schema.prisma > "$H/rebuild-status.log" 2>&1
/usr/bin/grep -q 'have not yet been applied' "$H/rebuild-status.log" || { echo "REBUILD FAILED: negative control"; exit 1; }
DATABASE_URL="$E2E_URL" DIRECT_URL="$E2E_URL" "$API/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma > "$H/rebuild-deploy.log" 2>&1 || { tail -n 5 "$H/rebuild-deploy.log"; exit 1; }
/usr/bin/grep -q 'All migrations have been successfully applied' "$H/rebuild-deploy.log" || { echo "REBUILD FAILED: deploy"; exit 1; }
echo "migrated on fresh water_erp_e2e (negative control passed)"
"$H/fresh.sh"
```

跑完 e2e 自查没有污染开发目录：`find /home/asus/桌面/ERP/water-erp/apps/api -path '*/node_modules' -prune -o -path '*/dist' -prune -o -type f -newermt 'N minutes ago' -print` 应为空。
