# Mock U盾中间件 + VendorUKeyAdapter 实装设计

日期:2026-08-26
状态:已批准(设计对话逐节确认)
前置:`docs/superpowers/specs/2026-08-20-dual-envelope-ca-opening-design.md`(双信封 v2,本设计是其 §3.3 VendorUKeyAdapter 骨架的落地路径)
关联包:`packages/ukey`(@water-erp/ukey)、`apps/supplier-portal`、新 `services/ukey-middleware/`

---

## 1. 背景与目标

双信封 v2 已全链落地,但私钥介质只有 `MockUKeyAdapter`(localStorage 软件介质),`VendorUKeyAdapter` 是三方法全抛错的骨架。本设计补齐「层 2」:一个**本地 mock U盾中间件服务**(模拟 CA 厂商装在客户机上的驱动服务)+ **VendorUKeyAdapter HTTP 实装**,逼真模拟真实 U盾从插入到拔出的全生命周期,提前排雷将来接真 CA(四川互认平台厂商)时的集成风险。

**模拟对象**:CA 厂商本机驱动中间件(如 CFCA/四川CA 的 localhost 服务)+ USB 盾硬件。

**验收形态**:开发机起中间件 → 发行一把盾 → 供应商门户自动探测切换到盾模式 → PIN 开锁 → 绑定证书 → 投标双层加密+盾签名 → 开标时盾解 kself;中途可演练 PIN 锁死、拔盾、中间件未启动等异常态。

## 2. 真实度锚点(模拟什么、不模拟什么)

锁定的真实语义:

1. **私钥永不出盾**:私钥运算只发生在中间件进程内(模拟盾芯片),浏览器只收 hex 结果。
2. **两个"在不在"是独立状态**:盾在不在 = 盾槽目录里有没有介质文件;中间件在不在 = 进程/端口存活。两者组合出真实用户会遇到的三种提示:未装驱动 / 已装驱动未插盾 / 已插盾待开锁。
3. **PIN 解锁会话**:一次解锁,空闲 N 分钟(默认 300s)自动上锁;解锁期间签名/解密不再要 PIN——真实盾行为。
4. **PIN 错误计数与锁死**:每盾独立计数,错 1 次减 1,减到 0 → 盾锁定;解锁需 PUK(发行时打印一次的管理码)。
5. **办证 = 柜台发行**:盾文件由 CLI 生成(`CN=企业名` 由发行方填),门户页面上没有"新建证书"按钮——真实 U盾的证书是 CA 机构发制的,用户拿到的是成品盾。
6. **证书列表免 PIN**:证书本是公开信息,枚举不需要 PIN;私钥操作(sign/decrypt)才要求该盾已解锁。
7. **多盾并存**:盾槽目录多文件 = 插多把盾,`/certs` 聚合枚举;每盾独立 PIN、独立会话、独立计数。
8. **文件字节不过盾**:大文件 SM4 加密在浏览器完成,盾只做 DEK 解封(kself SM2 解密)与信封签名——信封加密,与真实电子投标系统的 U盾用法完全一致。

**诚实边界(延续前置 spec §5 之声明)**:本中间件仍是自签密钥对(非 CA 机构颁发、无证书链/有效期/CRL),协议为项目自定;其签名/解密仅具开发、演示与集成排雷功能,不构成《电子签名法》第 13 条的「可靠电子签名」。演示材料涉及「U盾签名」表述须标注 mock 出处。真 CA 接入时按 §10 换轨。

## 3. 组件与目录

放置决策:`services/ukey-middleware/` 独立目录(不进 pnpm workspace,镜像 `services/ocr` 模式:start.sh 首跑自装依赖 + 根脚本启动)。理由:进程边界即真实中间件边界;不把 Node 服务端代码混进浏览器消费的 `packages/ukey`(其 tsconfig 无 @types/node)。

```
water-erp/services/ukey-middleware/
  package.json          # private, type:module; dependencies 仅 sm-crypto ^0.4.0(与 packages/ukey 同版); bin: ukeymw → src/cli.mjs
  start.sh              # 首跑 npm install --no-fund --no-audit,再 node src/cli.mjs serve
  README.md             # §8 联调剧本 + 异常剧本
  src/
    server.mjs          # 纯 node:http,零构建;导出 startServer({port, slotDir, ...}) 供 selfcheck 复用
    shield.mjs          # 盾介质文件读写/封装/PIN 计数/PUK 校验/发行
    session.mjs         # 解锁会话(内存态、空闲自动锁)
    cli.mjs             # serve / issue / list / unblock 四命令
    selfcheck.mjs       # 自动自验(随机端口起服务,全链 assert)
```

改动既有代码:

- `packages/ukey/src/vendor-ukey.ts`:三方法骨架实装为 HTTP 调用(纯 fetch + Web 标准 API,浏览器/Node 双端可用;不引入 Node API,包仍浏览器安全)。
- `apps/supplier-portal/src/utils/ukey-factory.ts`(新):探测与统一开锁入口。
- 三视图 `UkeyManage.vue` / `BidSubmit.vue` / `OpeningHall.vue`:各 ~3 行 diff 切换到 factory。
- 根 `package.json`:`"dev:ukey-mw": "cd services/ukey-middleware && bash start.sh"`(镜像 `dev:ocr`)。

## 4. 盾介质文件与盾槽

- **盾槽目录**:`UKEY_SLOT_DIR` env,默认 `~/.shuidi-ukey/slots/`;目录权限 0700、盾文件 0600(发行时设置)。
- 一文件 = 一把盾,文件名 `<shieldId>.ukey`;插盾 = 文件放入槽目录,拔盾 = 移走;中间件**每次请求实时扫描**槽目录(插拔即时生效,无缓存)。
- 盾文件格式(JSON):

```json
{
  "version": 1,
  "shieldId": "SHD-1A2B3C4D",
  "certSn": "SHD-1A2B3C4D",
  "certDn": "CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN",
  "publicKey": "04…(130 位 hex)",
  "alg": "SM2",
  "issuedAt": "2026-08-26T03:00:00.000Z",
  "kdf": { "algo": "PBKDF2-SHA256", "iterations": 210000, "salt": "<b64>", "pukSalt": "<b64>" },
  "encPrivKey": { "nonce": "<b64>", "ct": "<b64>" },
  "encPrivKeyPuk": { "nonce": "<b64>", "ct": "<b64>" },
  "pinPolicy": { "maxRetry": 6, "retryLeft": 6, "locked": false, "pukHash": "<sha256(puk+pukSalt)>" }
}
```

- 私钥封装与 `MockUKeyAdapter` 同参数族:AES-256-GCM(PBKDF2-SHA256(PIN, salt, 210k)) 加密 SM2 私钥 hex——**盾文件内永无明文私钥**。另存 **PUK 封装份**(`encPrivKeyPuk`,以 PUK+`pukSalt` 派生):PUK 权限高于 PIN,unblock 重设新 PIN 时经 PUK 份取私钥重封,**不需旧 PIN**——真实盾语义。
- `certSn` 直接复用 `shieldId`(演示口径,全局唯一即可);`certDn` 的 CN 由发行方传 `--cn`,须与平台注册企业名一致(否则绑定被 `bindCert` 的 DN 校验拒收——这正是要演练的校验)。
- PIN 校验方式:尝试解封 encPrivKey(GCM 认证失败=PIN 错),不单独存 PIN 哈希。
- PUK:发行时随机 12 位、**仅打印一次**,落盘仅存 `sha256(puk+pukSalt)`;unblock 校验通过后 `retryLeft` 重置为 maxRetry、`locked=false`,可顺带 `--new-pin`(经 PUK 封装份重封装私钥,不需旧 PIN)。

## 5. HTTP 协议(`127.0.0.1:17999`)

仅绑定 loopback(`UKEY_MW_BIND`,默认 127.0.0.1)。请求/响应均 JSON。CORS:默认放行 `http://localhost:*` 与 `http://127.0.0.1:*`(Origin 回显式),`UKEY_MW_ALLOW_ORIGIN` 可追加逗号分隔白名单;处理 OPTIONS 预检。

| 端点 | 方法 | 鉴权 | 请求 | 响应 / 错误 |
|------|------|------|------|------------|
| `/health` | GET | 无 | — | `{ok:true, version, shields:N, unlocked:M}` |
| `/certs` | GET | 无(PIN) | — | `{certs:[{certSn, certDn, publicKey, alg, shieldId}]}`;无盾 → 空数组 |
| `/session/unlock` | POST | PIN | `{pin}` | `{ok:true, unlocked:["SHD-…"], failed:[{shieldId, retryLeft}]}` |
| `/session/lock` | POST | — | — | `{ok:true}`(全部盾上锁) |
| `/sign` | POST | 盾会话 | `{certSn, data}` | `{sig}`(SM2,`{hash:true}`,与信封验签同参) |
| `/sm2/decrypt` | POST | 盾会话 | `{certSn, cipher}` | `{plain}`(hex→hex) |

错误响应统一 `{error, code}`,HTTP 状态映射:

| code | HTTP | 语义 |
|------|------|------|
| `BAD_REQUEST` | 400 | 参数缺失/格式错 |
| `SHIELD_NOT_FOUND` | 404 | certSn 定位不到盾(含拔盾:上一刻还在、此刻文件已移走) |
| `PIN_REQUIRED` | 403 | 该盾未解锁(含会话过期自动上锁后) |
| `SHIELD_LOCKED` | 423 | PIN 计数耗尽,需 PUK unblock |
| `PIN_INVALID` | 403(仅 unlock 内的 failed 项) | 附 `retryLeft`;某盾被本次尝试锁死时 `retryLeft:0, locked:true` |
| `DECRYPT_FAILED` | 422 | SM2 解密 C3 校验失败(密文损坏) |

会话语义:unlock 成功的盾在中间件**进程内存**记 `{shieldId, lastActive}`;每次私钥操作刷新 lastActive;距 lastActive 超过 `UKEY_MW_SESSION_TTL`(秒,默认 300)即视为已锁(惰性判定:下次操作时查;`/health` 的 unlocked 计数同理惰性重算)。`POST /session/lock` 与中间件重启(进程内存丢失)= 全部上锁。

多盾 unlock 语义:一次 `{pin}` 对**所有在场盾**逐一尝试验证——对的成功解锁,错的计数并列入 `failed` 数组(不整体失败);开发机常态一把盾,行为退化为单盾。

## 6. VendorUKeyAdapter 实装(`packages/ukey/src/vendor-ukey.ts`)

```ts
export class VendorUKeyAdapter implements UKeyAdapter {
  readonly name = 'vendor-ukey';
  static readonly VENDOR_BASE_URL = 'http://127.0.0.1:17999'; // 不变

  static async probe(timeoutMs = 300, baseUrl = VENDOR_BASE_URL):
    Promise<{ shields: number; unlocked: number } | null>;
  // 网络错误/超时/非 200 → null(门户据此提示「未检测到 U盾中间件」)

  static async open(opts: { password: string; baseUrl?: string }): Promise<VendorUKeyAdapter>;
  // probe → POST /session/unlock;PIN 错 → Error(含 retryLeft);failed 项全失败时列出各盾状态

  listCertificates(): Promise<CertInfo[]>;   // GET /certs(去 shieldId 字段,保持 CertInfo 形状)
  sign(certSn, msg): Promise<string>;        // POST /sign
  decrypt(certSn, cipherHex): Promise<string>; // POST /sm2/decrypt
}
```

- 全部 fetch + `AbortController` 超时(操作类 10s、probe 300ms);错误统一转译为中文 `Error`(message 含 code 与 retryLeft),风格与 MockUKeyAdapter 一致,UI 三视图无需区分错误展示。
- `static open({password})` 刻意镜像 `MockUKeyAdapter.open({storage, password})` 的工厂形状,三视图切换只改一行调用。
- `baseUrl` 可注入:apps/api 的 jest spec 用随机端口桩服务测它,不碰 17999。
- 实装后 `@water-erp/ukey` 需 rebuild(`pnpm --filter @water-erp/ukey build`),供应商门户 dev 需清 `node_modules/.vite`(Vite 预打包缓存,见 memory `vite-dep-cache-workspace-packages`)。

## 7. 门户接入(探测优先自动切换)

> **2026-08-26 勘误**:门户落点已随 303b5bca Vue→Next.js 迁移变更为 `apps/supplier-portal-next`,本文 Vue 路径(`apps/supplier-portal/…`、`UkeyManage.vue` 等)为写作时口径。

新增 `apps/supplier-portal/src/utils/ukey-factory.ts`:

```ts
export type UkeyKind = 'vendor' | 'mock';
export interface OpenedUkey { kind: UkeyKind; adapter: MockUKeyAdapter | VendorUKeyAdapter }

export async function detectUkey(): Promise<UkeyKind>;   // VendorUKeyAdapter.probe() → 'vendor' | 'mock'
export async function openUkey(password: string): Promise<OpenedUkey>;
// vendor 在线:VendorUKeyAdapter.open({password});离线:MockUKeyAdapter.open({storage, password})(现行为不变)
```

三视图改造(每处 ~3 行):`MockUKeyAdapter.open(...)` → `openUkey(...)`,并保留返回的 `kind` 供 UI 徽标:

- **UkeyManage.vue**:盾模式徽标「U盾(厂商中间件)」/ mock 模式「浏览器模拟介质」;**vendor 模式下隐藏 Mock 专属操作**(新建证书/导出介质/导入介质),显示「办证/补办请联系 CA 服务机构(演示:`ukeymw issue`)」——真实 U盾门户本无建证按钮。绑定/列表/解绑两模式共用。
- **BidSubmit.vue / OpeningHall.vue**:开锁入口同上切换;加密/组信封/解密逻辑零改动(信封代码只依赖 `UKeyAdapter` 接口)。
- 探测不到中间件时,UkeyManage 顶部提示条:「未检测到 U盾中间件——当前使用浏览器模拟介质。启动:`pnpm dev:ukey-mw`」。
- **现有 Mock 行为、`dual-selfcheck.ts`、`e2e-dual-envelope.ts` 55 项全部不动**(mock 是回落轨道,亦是 CI 轨道)。

## 8. 发行 CLI 与联调剧本

```
# ① 柜台办证(开发机模拟;打印盾文件路径与 PUK——PUK 仅此一次)
ukeymw issue --cn "四川水发建设有限公司" [--pin 123456] [--slot-dir ~/.shuidi-ukey/slots]

# ② 中间件上线(根目录)
pnpm dev:ukey-mw                          # :17999

# ③ 门户正常流
#    供应商门户 → U盾管理:徽标「U盾(厂商中间件)」→ 输 PIN 开锁 → 绑定(平台校验 CN↔企业名)
#    投标提交:选文件 → 浏览器双层 SM4 加密 → 盾签名信封 → 投递(服务端验签链不变)
#    开标:主持端解外层(管理方私钥,与盾无关);供应商开标大厅 → 盾解 kself → 明文上传(fieldsCommit 双闸不变)

# ④ 异常剧本(每条都是将来真 CA 会踩的坑)
#    a. 中间件没启动      → 门户回落 mock,提示条指引启动
#    b. 盾未插(文件移走)  → /certs 空;UkeyManage 提示「未检测到 U盾」
#    c. 错 PIN ×6         → SHIELD_LOCKED;ukeymw unblock --puk <PUK> [--new-pin] 解锁
#    d. 解锁后闲置 5min    → 自动上锁,再签名 → PIN_REQUIRED
#    e. 解锁后拔盾再操作   → SHIELD_NOT_FOUND
#    f. 会话中重启中间件   → 全部上锁,需重新开锁

# ⑤ 其他命令
ukeymw list [--slot-dir]                  # 在场盾清单(证书信息 + 锁定状态 + 剩余计数)
ukeymw serve [--port 17999] [--slot-dir …]
```

## 9. 测试与自验

| 层 | 内容 |
|----|------|
| `selfcheck.mjs`(`pnpm --filter` 不可用,直接 `node src/selfcheck.mjs`,README 记载) | 临时槽目录 + 随机端口 `startServer()` → issue 两把盾 → `/health`/`/certs` 聚合 → 错 PIN 计数递减 → 连错 6 次 → SHIELD_LOCKED → unblock → 正确 PIN 解锁 → 用 sm-crypto 以盾公钥 doEncrypt 随机 DEK 后走 `/sm2/decrypt` 回环比对 → `/sign` 产物用 sm-crypto 公钥反向验签(sm-crypto 是服务自身依赖,无需 import @water-erp/ukey)→ 空闲 TTL 惰性上锁断言。全链 `node:assert` |
| `apps/api/src/common/crypto/vendor-ukey.spec.ts` | `node:http` 起随机端口迷你桩:probe 在/离线(离线=null)、open 成功/错 PIN 错误转译(含 retryLeft)、三方法透传、PIN_REQUIRED/SHIELD_LOCKED/SHIELD_NOT_FOUND 映射为中文 Error |
| 手工验收 | §8 剧本 ①→③ 全流程 + 异常 a–f 各演练一遍 |
| 回归 | 现有 mock 轨道测试(dual-selfcheck、e2e 55 项、supplier-portal.service.spec 双信封段)零改动、全绿 |

## 10. 与真 CA 的差异与迁移面(接真 SDK 时)

- **只改 `vendor-ukey.ts`**:协议端点换厂商 SDK 的(多为 WebSocket/私有 JS 封装),DER/PEM↔hex 编码转换在 adapter 内消化(前置 spec §3.3 既定);`probe`/`open` 的 UX 形状不变。
- **门户、信封、服务端零改动**——本设计即前置 spec「业务代码零改动」目标的实弹验证。
- 留档校准项:CORS/端口按厂商文档;PIN 策略(长度/锁死阈值)按盾型号;错误码语义按 SDK 错误表重新映射。
- 本 mock 中间件在真 CA 接入后转为联调降级工具,不删。

## 11. 配置项汇总(env)

| 变量 | 消费方 | 默认 | 说明 |
|------|--------|------|------|
| `UKEY_SLOT_DIR` | 中间件/CLI | `~/.shuidi-ukey/slots` | 盾槽目录 |
| `UKEY_MW_PORT` | 中间件 | `17999` | 监听端口(CLI `--port` 同义) |
| `UKEY_MW_BIND` | 中间件 | `127.0.0.1` | 绑定地址(勿改 0.0.0.0,loopback 是安全边界) |
| `UKEY_MW_SESSION_TTL` | 中间件 | `300` | 解锁会话空闲秒数 |
| `UKEY_MW_ALLOW_ORIGIN` | 中间件 | —(内置 localhost/127.0.0.1 白名单) | 追加 CORS Origin,逗号分隔 |

## 12. 非目标

- 不做证书链/有效期/CRL/OCSP(自签演示,§2 诚实边界)。
- 不做真 USB 硬件交互;插拔=文件在不在。
- 不改双信封协议、不改服务端验签链、不动管理方证书体系(`AdminEncryptionCert` 与盾无关,外层照旧)。
- 不在 CI 常驻跑中间件(CI 保持 mock 轨道;selfcheck/jest 桩服务用随机端口,CI 跑得动则挂入 validate job,不作为闸门)。
