# Mock U盾中间件(:17999)

模拟 CA 厂商本机驱动服务 + USB 盾(全仿真:盾文件插拔 / PIN 会话 / 锁死 PUK / 柜台发行)。
设计 spec:`docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md`。
**诚实边界**:自签密钥对,不构成《电子签名法》可靠电子签名;演示材料涉「U盾签名」须标注 mock 出处。

## 威胁模型(loopback 语境,书面决定)

- **CORS 只挡读不挡写**:本机恶意页面可对 `127.0.0.1:17999` 发 simple request(content-type 之外无自定义头的 POST 不触发预检)调 `/session/unlock` 烧 PIN 计数直至锁盾——响应读不到,请求照发。
- **解锁窗口无进程隔离**:PIN 解锁期间,本机任意进程均可直接调 `/sign`、`/sm2/decrypt`(loopback 无鉴权)。
- 两者均在 dev 演示边界内接受;真 CA 接入时按 spec §10 重审(真驱动有进程校验/令牌/硬件在场检测)。

## 快速开始

```bash
node src/cli.mjs issue --cn "四川水发建设有限公司" --pin 123456   # 办证,打印 PUK(仅一次,抄录!)
pnpm dev:ukey-mw                                                # 根目录启动中间件(water-erp/ 下)
```

供应商门户(:3004)→ U盾管理:自动探测到中间件 → 徽标「U盾(厂商中间件)」→ PIN 开锁 → 绑定 → 投标/开标全流程。

## 联调剧本(异常态)

| 场景 | 操作 | 预期 |
|------|------|------|
| 中间件未启动 | 不起服务开门户 | 回落「浏览器模拟介质」+ 提示条 |
| 未插盾 | `mv ~/.shuidi-ukey/slots/*.ukey /tmp/` | /certs 空,门户「未检测到 U盾」 |
| 错 PIN ×6 | 连续输错 | SHIELD_LOCKED;`node src/cli.mjs unblock --shield SHD-… --puk <PUK>` 解锁 |
| 闲置 5min | 解锁后等待 | 自动上锁,再操作 → 重新开锁 |
| 拔盾后操作 | 解锁状态下移走文件 | SHIELD_NOT_FOUND |
| 重启中间件 | Ctrl-C 再起 | 全部上锁,须重新开锁 |

## 端点与配置

端点/错误码见 spec §5;env:`UKEY_SLOT_DIR`(默认 `~/.shuidi-ukey/slots`)、`UKEY_MW_PORT` 17999、`UKEY_MW_BIND` 127.0.0.1、`UKEY_MW_SESSION_TTL` 300、`UKEY_MW_ALLOW_ORIGIN`。
