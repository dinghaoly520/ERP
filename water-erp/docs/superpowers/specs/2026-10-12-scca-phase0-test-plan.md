# 四川CA 阶段0 实测清单——网关协议等价与实盾采样

日期：2026-10-12（v3；v2 按外部审查一轮修订，v3 按二轮复核修订）。上游设计：[主方案](2026-10-10-scca-integration-design.md) + [附录契约](2026-10-12-scca-ui-api-contracts.md)（下称「主方案」「附录」）。本文是阶段 0 的**可执行**操作文档：环境搭建、逐用例输入构造、判定表、证据规范。

状态：**阶段 0 收官（2026-10-13）——C-1..C-13 全部落定（11 PASS/2 PASS*/1 BLOCKED），能力矩阵 8 放行/2 阻断（证书状态在线检查、可信时间戳→厂商清单）；未覆盖清单项不阻塞阶段 1。终版见 §8 与 `phase0-evidence/结论回填表.md`、`能力与阻断项矩阵.md`。**前提：**实体测试盾已到位**（≥1 把；双盾用例标 ⛁ 为条件项）。Windows 测试机一台、Linux 开发机（本机）一台。

**v2 修订记录**（六处，对应外部审查 2026-10-12）：

1. transport：超时=清定时器+摘监听+**关闭旧连接+换代次**（迟到帧无处误配）；connect 缓存共享 promise、仅 OPEN 才发送；PIN 参数在记录入口按 action 掩码 + 密码控件入口；失败命令与 GetLastError 合成同一队列动作。
2. probe：参数白名单（拒绝未知参数）；表单与 HMAC 由**同一份排序去空字段集**生成；显式超时与响应大小上限；鉴权原文/签名值只进 evidence 文件；G6 独立请求定义。
3. p7walk：正确 CMS 提取路径 + EnvelopedData 判读；解析失败=INCONCLUSIVE，绝不猜测 detached。
4. 判定收紧：G0 加负对照、G3 加失败后复验、G4 4c 语义改为「World B 证据，禁止作为约定依据」、G5/G7 降为存在性观察、S8 撤回「可并行化」推断。
5. 细节修正：S3 前置闸（成功登录+剩余次数≥3 才做单次错误）、S6 同证同明文重封、S10 冷启动与来源矩阵、V7 修正为 64 hex 且完整可复制、新增 S12（HTTPS→本机 WSS）、A.2 脚本移到 body 末尾。
6. 证据纪律：逐调用编号 `P0-GW-NNN` 与 PASS/FAIL/INCONCLUSIVE/NOT_RUN 状态机、预算覆盖附录 E 与全部负例、原件/摘要分治；新增 T 组「工具自证」，执行顺序改为「离线工具 → 采集 → 离线解析 → 有预算网关 → 矩阵」。

**v3 修订记录**（外部审查二轮，四类问题全部核实成立后修入）：
① transport 每请求固定自身 socket/generation（超时只关自己的连接）；connect 加 8s 等待超时、打开前关闭必须 reject；断连立即 settle 在途请求并 `queueEpoch++` 使旧队列整体失效（排队中的签名绝不跨连接续发）；登录仅在收到真实失败帧时同连接查 GetLastError。
② probe 参数解析拒绝「值以 -- 开头」/重复/缺值（v2 的 `--out --badSignature` 会把后者吞成文件名→负对照实发正常鉴权）；非 localhost 调用缺 `--callNo`/`--out` 直接退出；响应按**字节**流式限读（计时覆盖全程，v2 的字符 slice 在全量读入后才生效）；`hmacPlain/hmacSignature` 只写 `<out>.debug.json`，脱敏 evidence 不含。
③ p7walk contentType **白名单**（未知 OID 一律 INCONCLUSIVE，废除 v2 的 SET 数猜测）；encapContentInfo 严格形状（非法标签不判 detached）；sid 区分 issuerAndSerial/SKI（含 0x80 隐式）；算法连参数子树；`[0]` 证书集逐张 sha256+serialHex，`--expectCertSha256/--expectSerial` 做「实际签名者=本地所选证书」指纹闭环。
④ T1 改为旧/新 socket 分别注入帧+队列失效断言（FakeWS 补 instances 注册表/双分发/故障注入）；T3 两端共用 `t3-manifest.json` 同一输入清单（含空串向量）；T2 扩充为七类样本（含 SKI/多签名者/EnvelopedData/未知 OID/非法结构）。
判定文字同步：G3 3a' 固定第 4 发、本地比对无条件强制（删「World B 才升格」）；E-2 归因以 S5 离线内嵌字节为准；E2 改用 `parseCertificate`（实际导出名）+兼容组合矩阵；能力矩阵改「所需检查覆盖已证明」。

PIN 默认值口径：标准发行盾 `12345678` 有安装须知书面依据；非标项目盾须以随附文档/厂商书面确认为准，**未经确认不得以默认值试探**。

执行纪律（全程有效）：

- **每用例产出一个 evidence JSON**（§6 schema），结论只认证据不认印象；
- 暂时拿不到样本的项**明确记 NOT_RUN/未覆盖**，不标通过（与主方案 §9 口径一致）；
- **每次真实网关调用分配编号 `P0-GW-NNN`**，先登记预算台账再发（§7）；
- **红线见 §1.5**（不锁死唯一测试盾、凭据不入库、网关调用预算制、先工具自证后实网关）。

## 0. 结论映射总表（每项测试解锁什么决定）

| 编号 | 结论 | 来源用例 | 回填到 |
|------|------|---------|--------|
| C-1 | 网关是否校验 toSign（World A/B 判决） | **G3**（含负对照与复验） | P0-1 消解：本地 attached-P7 原文比对无条件强制（World 仅为信息项）；附录 §7.2 第 2 行 |
| C-2 | 登录原文前缀约定（预加 `LOGONDATA:` 直传？） | **G4** | 主方案 §2、附录 §4.2 B.14 |
| C-3 | SDK 请求字节六项声明证实/证伪（字段集/顺序/HMAC 原文/双侧跳空/表单编码/前缀） | **G1**+T3 | `SccaGatewayClient` 实现基线 |
| C-4 | HMAC-SHA1 规则跨实现等价（Node=JAR 行为） | G1+G2+T3 | `scca-gateway.client` 单测固定向量 |
| C-5 | opType 样本接受性（存在性观察，不推导任意可用） | G5 | 附录 §4.2 F.96-97；映射表以厂商书面为准 |
| C-6 | certValidate 响应结构与状态语义 | G6 | 证书状态检查实现（附录 §4.2 D.58） |
| C-7 | requestId 重复请求观察（不推导去重/计费/重试安全） | G7 | 附录 §4.2 F.101：维持禁止自动重试 |
| C-8 | P7 内嵌原文形态（原始 UTF-8 字节？Base64 文本？detached？） | **S5** | 本地比对函数形态；「只收 attached」校验 |
| C-9 | 签名/摘要算法 OID——「国际算法 PKCS#7」之谜（SM2 还是 RSA） | S5+E2 | 主方案 §4 算法策略闸、附录 §6.1 x509 行 |
| C-10 | 双证书容器模型与用途边界 | S1/S2/S7 | `SccaUKeyAdapter` 双证书模型 |
| C-11 | 密钥封装往返可行性与 P7 密文尺寸、封装算法参数 | **S6**+S5 | wrapKey/unwrapKey 设计；附录 §2.5 限额校准 |
| C-12 | 无关联 ID 串包实证 / 多标签登录态归属 / 断连行为 | S8/S9/S10 | 受控通道队列+generation 设计参数 |
| C-13 | CertData 身份字段**双源**出处（网关原生 vs JAR 从 DER 本地解析）与回填 | E1（+G1-R2b） | 绑定流程第 4 步身份来源；空→升级厂商问题 |

G 组的实网关部分依赖 S4 产出的真实 P7；T 组全部离线，最先执行。

## 1. 资产与环境

### 1.1 资产清单

| 资产 | 位置/来源 | 备注 |
|------|----------|------|
| 实体测试盾 | 供应商提供 | 记录每把盾的证书序列号后 8 位（脱敏入档）；第二把为 ⛁ 条件项 |
| 证书助手安装包 | `四川CA/sccpInstaller.zip` → `sccpInstaller.exe` | Windows 7+；安装时拔盾、关闭浏览器（安装须知） |
| demo 开发包 | `四川CA/sccm-JAY/` | `sccmPlugin.js`（协议基准）+ 示例页 + `WEB-INF/lib/`（Java harness classpath） |
| 测试网关凭据 | `sccm-JAY/doCertLogon-JAY.jsp:47-49`（appId/appSecret） | **有效性以 G0（含负对照）实测为准**；本文档不复制其值 |
| Windows 测试机 | — | Chrome（安装须知推荐）；无需 Node（harness 为纯浏览器页） |
| Linux 开发机 | 本机 | Node v24（probe/sink/p7walk）、OpenJDK 11（单文件源启动，免 javac）、openssl（T2/E2） |

### 1.2 Windows 环境（一次性）

1. 解压 `sccpInstaller.zip`，**拔盾、关闭浏览器**后安装证书助手；
2. 插入测试盾 → 打开证书助手 → 首页应显示证书序列号/所有者/有效期 → 点「环境检测」，检测正常为准；
3. 记录：证书助手版本号、盾内每张证书的序列号后 8 位与有效期（→ `S0` 证据）；PIN 以盾随附文档为准（标准发行盾=12345678，见安装须知问题一）。

### 1.3 测试台（harness）

本地文件夹 `phase0-harness/`（建议放在测试机任意目录，**不必入 git**）：

```
phase0-harness/
  index.html        # 采集页（附录 A.2）
  transport.js      # 受控 WSS 通道 v2（附录 A.1）——不加载 sccmPlugin.js
  fake-ws.js        # T1 工具自证用假 WebSocket（附录 A.3，仅测试台加载）
```

启动：`python -m http.server 8080`（或 VS Code Live Server；`file://` 直开通常也可，若 WSS 被拦再换 http）。浏览器开 `http://localhost:8080/index.html`，DevTools 控制台按 §4 用例逐条执行，结果经 `P0.dump()` 导出。

设计要点（已在 transport.js v3 落实）：

- **不用 demo 的 `sccmPlugin.js`**：其 `getMessage` 在错误码 184550659 时自动弹 PIN 框并递归重发（:383-413），且每次请求覆盖同一个 `onmessage`（:313-328，无关联 ID）。测试台用 FIFO 队列串行 + 每请求固定自身连接/代次 + 超时只关自己的连接 + 队列代次失效（`queueEpoch`，排队命令不跨连接续发），PIN 一律显式 `P0.loginSelected()`——这本身就是主方案 §4「受控通道」的原型验证；
- **编码用干净实现**：demo 的 `base64Encode`→`_utf8_encode` 会 `\r\n→\n` 改写字节、4 字节 UTF-8 编错（:1664-1683）；测试台用 `TextEncoder`+`btoa`，V5/V6 向量专门对照此差异；
- WSS 模式下容器名**原样**传（`encodeURIFun` 在 WSS 分支是恒等函数，:1738-1746）；
- **PIN 只经 `P0.readPin()` 密码控件进入**（仅存本页内存、用后即清），控制台命令不携带明文，`rec()` 入口另按 action 掩码兜底。

### 1.4 Linux 侧

- probe / sink / p7walk 见附录 B/D，Node 24 全局 fetch 即可，无 npm 依赖；openssl 供 T2 合成 P7 与 E2 独立解析；
- Java capture harness 见附录 C：`java -cp "<sccm-JAY>/WEB-INF/lib/*" SccaCapture.java`（Java 11 单文件源启动，免 javac）。

### 1.5 凭据与红线（先读后做）

1. **不锁死唯一测试盾**：S3 设前置闸（§4）——先正确登录成功、读取可靠剩余次数且 ≥3，才做**一次**错误 PIN，随即恢复。次数未知/≤1/通信异常 → 跳过（NOT_RUN）。锁死阈值与 PUK 解锁不做实测，记「未覆盖」。
2. **凭据不入库不入档**：probe 从环境变量读 `SCCA_BASE_URL/SCCA_APP_ID/SCCA_APP_SECRET`；evidence 中凭据掩码（appId 保留前 6 位 + `***`）；PIN、鉴权原文、鉴权值不进控制台与入库摘要。
3. **网关调用预算**：全程 ≤23 次（§7 台账），**先 T 组离线自证工具，再发第一次真实调用**。测试网关是计量商务接口，禁止循环试错。
4. 测试网关为 HTTP 明文（`http://testmicrosrv.scca.com.cn:9527`）——仅测试可用，生产必须 HTTPS（主方案 §3）。
5. 安装包、盾、网关响应均按不可信数据处理：harness 只在本机做读写签名；唯一外联是 Linux probe 发我们构造的参数。
6. 过滤项疑似粘滞（`SOFE_SetCertFilter` 重置语义未知）——S1 的过滤子测试放在**无过滤主采集之后**。

## 2. T 组：工具自证（离线，零外联，最先执行）

> 依据（外部审查两轮）：先离线验证测试工具本身，再让它接触真实盾与网关。**工具不过 T 组，不进入采集与网关阶段。**

### T1 transport v3 行为验证（假 WebSocket 注入）

测试页（独立于正式 harness）：`<script src="fake-ws.js"></script>`（自动注入 `window.WebSocket = FakeWS`），再加载 transport.js。测试时可临时把 transport 顶部 `OP_TIMEOUT_MS` 调小（如 2000ms）加速，跑完恢复。

| # | 场景 | 构造 | 必须观察到 |
|---|------|------|-----------|
| T1-a | 超时只关自己的连接；旧 socket 帧不误配 | `FakeWS.script=[()=>{}]`（第一问不回包）→ `P0.rawCall('SOF_GetVersion',[])` 等超时；再 `FakeWS.script=[(s)=>s.emit('message',{data:JSON.stringify({action:'SOF_GetUserList',retValue:'a||c&&&'})})]` → `P0.userList()`；随后**向旧实例**注入帧：`FakeWS.instances[0].emit('message',{data:JSON.stringify({action:'SOF_GetVersion',retValue:'LATE'})})` | 超时后旧 socket `readyState===3` 且 gen 递增；userList 结果=`a||c&&&`（**绝 ≠ LATE**）；旧 socket 的帧只产生 `late-frame`/静默记录，绝不 resolve 新调用 |
| T1-b | 队列失效：排队命令不跨连接续发 | `FakeWS.script=[()=>{}]`；`const p1=P0.rawCall('SOF_GetVersion',[]); const p2=P0.rawCall('SOF_GetUserList',[]);`（p2 立即入队） | p1 超时后，p2 **reject 且 message 含 QUEUE_INVALIDATED**；`FakeWS.instances.at(-1).lastSent===null`（从未发出）；显式重新调用才在新连接执行 |
| T1-c | 连接等待超时 | `FakeWS.openDelay=9000`（> 8s 连接超时）→ 任一 rawCall | ~8s reject「WSS 连接超时」，不挂起、不发送 |
| T1-d | 打开前关闭不悬空 | `FakeWS.closeBeforeOpen=true` → 任一 rawCall | connect 立即 reject「连接在打开前关闭」，Promise 不悬空 |

（FakeWS v3 补齐了 `instances` 注册表与 `emit` 对 listeners+`onmessage` 属性的双分发——v2 只派发监听器，late-frame 路径根本测不到，见附录 A.3。）

### T2 p7walk v3 对合成样本（openssl 造件 + 构造异常件）

```bash
# 基础件
openssl req -x509 -newkey rsa:2048 -nodes -keyout t.key -out t.crt -subj "/CN=p0-t" -days 1
openssl req -x509 -newkey rsa:2048 -nodes -keyout t2.key -out t2.crt -subj "/CN=p0-t2" -days 1
printf 'SCCA-P0-V1::plain-ascii-0123456789' > V1.txt
# ① attached（正例）  ② detached  ③ SKI 形态签名者  ④ 多签名者  ⑤ EnvelopedData（密钥包形态）
openssl cms -sign -nodetach -binary -in V1.txt -inkey t.key -signer t.crt -outform DER -out v1.p7.der
openssl cms -sign -binary        -in V1.txt -inkey t.key -signer t.crt -outform DER -out v1d.p7.der
openssl cms -sign -nodetach -binary -keyid -in V1.txt -inkey t.key -signer t.crt -outform DER -out v1ski.p7.der
openssl cms -sign -nodetach -binary -in V1.txt -inkey t.key -signer t.crt -inkey t2.key -signer t2.crt -outform DER -out v1multi.p7.der
openssl cms -encrypt -binary -in V1.txt -aes256 -outform DER -out w1.p7.der -recip t.crt
for f in v1 v1d v1ski v1multi w1; do base64 -w0 $f.p7.der > fixtures/$f-synth.p7.b64; done
```

```bash
# ⑥ 未知 OID（合法件字节级替换为同长度未知 OID）  ⑦ 非法 encapContentInfo（OID+非法 [1]）
python3 - <<'PY'
b = bytearray(open('v1.p7.der','rb').read())
old = bytes.fromhex('06092A864886F70D010702')          # OID 1.2.840.113549.1.7.2（内容 9 字节；060A 模式不存在——v3.1 执行修正）
i = b.find(old); assert i > 0
b[i+2:i+11] = bytes.fromhex('2A864886F70D017F7F')       # → 1.2.840.113549.1.127.127（同 9 字节未知 OID）
open('v1-unknown-oid.p7.der','wb').write(bytes(b))
def L(n):
    if n < 128: return bytes([n])
    h = n.to_bytes((n.bit_length()+7)//8,'big'); return bytes([0x80|len(h)])+h
def T(t,v): return bytes([t])+L(len(v))+v
OID_DATA   = bytes.fromhex('06092A864886F70D010701')
OID_SIGNED = bytes.fromhex('06092A864886F70D010702')
encap = T(0x30, OID_DATA + T(0xA1, b'illegal'))          # 非法 [1] 内容标签
sd    = T(0x30, T(0x02, b'\x01') + T(0x31, b'') + encap + T(0x31, b''))  # 双 SET（空 signerInfos）→ 命中「非法标签」专属分支
open('illegal-encap.p7.der','wb').write(T(0x30, OID_SIGNED + T(0xA0, sd)))
PY
base64 -w0 v1-unknown-oid.p7.der > fixtures/v1-unknown-oid.p7.b64
base64 -w0 illegal-encap.p7.der > fixtures/illegal-encap.p7.b64
```

| 样本 | p7walk v3 必须输出 | 验证的缺陷（v2 曾错） |
|------|-------------------|---------------------|
| ① attached | eContent == UTF8(expect)；cert[0] sha256；signer sid=issuerAndSerial | 基线 |
| ② detached | 「仅 [OID] → detached 形态」 | — |
| ③ SKI | `sid: subjectKeyIdentifier` 且**两个算法 OID 都打印** | v2 SKI 形态漏报摘要算法 |
| ④ 多签名 | `signerInfos: 2` | — |
| ⑤ enveloped | recipient serialHex / keyEncAlg OID / contentEncAlg OID(aes) | — |
| ⑥ 未知 OID | **INCONCLUSIVE**（不判 SignedData） | v2 按 SET 数误判 |
| ⑦ 非法 [1] | **INCONCLUSIVE**（不判 detached） | v2 误报 detached |

### T3 probe ↔ JAR 双捕获 diff（同一输入清单）

**共享输入清单 `t3-manifest.json`——两端从同一份文件取参**（v2 缺陷：两端输入不同导致 HMAC 必不相等，「相同输入等价」无从验证）：

```json
{ "baseUrl": "http://127.0.0.1:9331/", "appId": "P0-FICTIONAL-APPID", "appSecret": "p0-secret-fake",
  "runs": [
    { "id": "t3-a", "opType": "业务签署", "requestId": "p0-t3-a",
      "toSignFile": "t3-inputs/t3-a-toSign.txt", "p7File": "t3-inputs/t3-a-p7.b64" },
    { "id": "t3-b", "opType": "登录签名", "requestId": "p0-t3-b",
      "toSignFile": "t3-inputs/t3-b-toSign.txt", "p7File": "t3-inputs/t3-b-p7.b64" },
    { "id": "t3-c", "opType": "业务签署", "requestId": "p0-t3-c",
      "toSignFile": "t3-inputs/t3-c-toSign.txt", "p7File": "t3-inputs/t3-c-empty.b64" },
    { "id": "g1-r2", "kind": "certLogin", "opType": null, "requestId": "p0-g1-r2",
      "toSignFile": "t3-inputs/t3-b-toSign.txt", "p7File": "t3-inputs/t3-b-p7.b64" },
    { "id": "g1-r3", "opType": "登录签名", "requestId": "p0-g1-r3",
      "toSignFile": "t3-inputs/t3-a-toSign.txt", "p7File": "t3-inputs/t3-a-p7.b64",
      "secretOverride": "虚构密钥-中文" }
  ]
}
```

- t3-a 的 toSign 含中文/`&`/`+`//`/换行；t3-c 的 p7 文件为**空文件**（空串向量——验证表单与 HMAC **双侧**跳空一致，兼作 G1 判定 d 的证据）；t3-d（opType=null）**仅 Java 侧观测**（probe 的 CLI 无法表达 null；服务端实现也永不出 null）——记录 JAR 对 null 的行为即可。
- 准备：`mkdir t3-inputs`，写 3 个 toSign 文件与 3 个 p7 文件（t3-a/t3-b 可用 T2 合成 P7，内容任意但两端同源）。
- 执行（两端分别打 sink，各留一份捕获日志）：

```bash
python3 sink.py > sink-java.log 2>&1 &
java -cp "<sccm-JAY>/WEB-INF/lib/*" SccaCapture.java t3-manifest.json
# 重启 sink 换日志后，probe 侧逐 run（同一清单同一文件）：
run() { node probe.mjs verify --path /api/signature/verifyPkcs7 --requestId "$1" --opType "$2" --p7 "$3" --toSignFile "$4"; }
run p0-t3-a 业务签署 t3-inputs/t3-a-p7.b64 t3-inputs/t3-a-toSign.txt
run p0-t3-b 登录签名 t3-inputs/t3-b-p7.b64 t3-inputs/t3-b-toSign.txt
run p0-t3-c 业务签署 t3-inputs/t3-c-empty.b64 t3-inputs/t3-c-toSign.txt
```

- 比对（逐 run，t3-a/b/c 三组）：两份 sink 日志中同 run 的请求——`app_id`/`signature`/`content-type` 头**原文全等**、表单字段集与顺序全等（t3-c 必须**双侧都不含** signedData 字段）、HMAC 值全等。任一不等 → 以 JAR 捕获为准修 probe，**不得进入 G 组**。g1-r2/g1-r3 仅供 G1（Java 侧独有），不参与 diff。


## 3. G 组：网关协议（Linux；实网关部分消耗预算并依赖 S4 产出）

### G1 ★ SDK 请求字节捕获（本地 sink 法）——一切协议声明的黄金证据

**思路**：`SccaGwSDK.init()` 指向本机 sink（127.0.0.1:9331），调 `validateSignaturePkcs7` / `certLogin`，捕获 SDK 实际发出的完整 HTTP 请求，离线反推协议六项声明。零外联、虚构凭据。

步骤：
1. `python3 sink.py`（附录 C.1）开在 9331；
2. `java -cp "…/WEB-INF/lib/*" SccaCapture.java t3-manifest.json`（附录 C.2 v3：从 §2 T3 的同一清单取参——t3-a/b/c/d 业务验签（t3-c 空串向量兼作判定 d 的双侧跳空证据）、g1-r2=certLogin（LOGONDATA 前缀证据）、g1-r3=非 ASCII Secret 覆盖）；
3. （S2 完成后回跑 **R2b**）`export P0_CERT_B64=$(tr -d '\n' < S2-sign-cert.b64)` 重启 sink 再跑 R2——伪证书换真 DER 后 `certLogin` 可完整走通，其返回 JSON 里的 `data` 即 JAR 从 DER **本地解析**出的 CertData（→ E1 源 B 的离线证据）；
4. sink 终端逐条复制请求记录 → `evidence/G1-*.json`。

判定表（逐项对主方案 §2「开发包协议实现基线」）：

| # | 声明 | 核对方法 | 证实→ | 证伪→ |
|---|------|---------|-------|-------|
| a | 路径 `baseUrl + api/signature/verifyPkcs7` | sink path | 维持 | 修正基线 |
| b | 表单字段集恰为 opType/requestId/signedData/toSign | body 解码 | 维持 | 记录真实字段集（注意 projectId 是否出现） |
| c | HMAC 原文=键升序、跳 null/空串、仅值 `&` 连接、不先 URL 编码 | 用捕获 body 的**解码后**值按规则重算 HMAC 与 `signature` 头比对 | 维持 | 按捕获反推真实规则，改 probe 与设计 |
| d | **表单与 HMAC 同源省空**（JAR 双侧一致） | 构造含空值参数的调用（R1 变体），看 body 是否也不含空字段 | 维持（probe v2 已按此实现） | 记录差异 |
| e | HMAC-SHA1、小写 hex | 重算即证 | 维持 | 修正 |
| f | `certLogin` 给 toSign 加一次 `LOGONDATA:`、opType=登录签名 | R2 捕获 | 维持「ERP 预加直传」方案 | 若不加前缀，G4 判定表另行校准 |
| g | JAR 对非 ASCII Secret 用平台默认字符集 | R3 与 R1 同文本不同密钥，重算验证本机（Linux=UTF-8）可复现 | 维持「向厂商要 ASCII 凭据或双端验证」 | — |

注：SDK 对 sink 假响应在**响应解析**阶段抛错属预期——请求字节已捕获，不影响判定（R2b 换真 DER 后可走通）。

### G2 HMAC 跨实现固定向量

用 G1 证实的规则在 Node（probe 的 hmac 函数）跑下表，与 Python/JAR 捕获值互证；向量固化进将来 `scca-gateway.client.spec.ts`：

| 向量 | opType | requestId | signedData | toSign |
|------|--------|-----------|------------|--------|
| H1 纯 ASCII | `登录签名` | `req-001` | `QUJD` | `hello` |
| H2 中文 | `登录签名` | `req-002` | `5aCn6ZmG` | `中文原文&加号+斜杠/` |
| H3 空值跳过 | `登录签名` | `req-003` | `` (空) | `x&y` |
| H4 换行 | `登录签名` | `req-004` | `QQ==` | `a\nb\r\nc` |

### G0 连通与凭据有效性（含负对照，G1 之后）

| # | 操作（probe） | 观察 | 判定 |
|---|--------------|------|------|
| 0-a | 正常签名头 + dummy P7（`--p7 fixtures/V1-synth.p7.b64`） | 响应码/错误类别 | 若得**签名/证书类业务错** → 候选「凭据有效」 |
| 0-b | **负对照** `--badSignature`（确定性错误鉴权值） | 响应码/错误类别 | 若与 0-a **不同**且属鉴权类错 → 凭据有效确证；若负对照同样成功 → **网关不强制鉴权**（测试环境可能放行）→ 凭据有效性「未判定」，升级厂商问题 |

**判定纪律（审查修订）**：签名类错误只证明收到该错误，**不能单独证明凭据有效**；必须负对照配合。0-a/0-b 均失败（网络/超时）→ 先解决链路，G0=INCONCLUSIVE。

### G3 ★ 错误原文判决（World A/B）——四发固定序列

前置：S4 已产出向量 V1 的真实 P7。同一枚 P7 复用（不重签），**固定四发，顺序不可变**：

| # | signedData | toSign | 观察 |
|---|-----------|--------|------|
| 3a | P7(V1) | V1 原文（正确） | **必须先成功**；失败 → G0/网络复排，本组 INCONCLUSIVE |
| 3b | P7(V1) | V1 改 1 字节 | 判决点① |
| 3c | P7(V1) | 换成完全不同的 V2 原文 | 判决点②（防宽松归一化） |
| 3a' | P7(V1) | V1 原文 | **固定第 4 发（无论 3b/3c 结果如何都执行）**：服务健康复验——通过 → 前序失败可归因于 toSign 差异、前序通过序列也可信；不通过 → 限流/环境问题，全组 INCONCLUSIVE |

判定（失败原因须从响应体错误类别区分出「验签/原文类」；无法与鉴权、限流等其他原因区分时 INCONCLUSIVE）：

- 3b/3c 均拒 + 3a' 过 → **World A**（网关绑定原文）。设计维持；
- 3b/3c 任一通过 + 3a' 过 → **World B**（网关不比对原文）。结论表标注此局限；**须先证明「签名—内嵌内容—实际签名者」三者验证关系完整**（S5 提供内嵌内容与 signer 指纹），再确定组合验证方案，并同步主方案上线条件——不得直接标「风险已消解」；
- **两个 World 下本地 attached-P7 原文比对均无条件强制**——与 World 判定无关；World A/B 只影响是否额外叠加「网关侧原文绑定」这一层（v2 的「World B 才升格」表述作废）；
- 附带记录：响应是否回显 requestId、certBase64/CertData 字段集（→ E1 素材、成功 fixture）。


### G4 LOGONDATA 前缀约定

**分别记录「盾签字节」与「网关原文」两个文件**（toSign 文件 + P7 文件成对归档）。用 S4 的 V7（含前缀完整登录形态）与 V1：

| # | P7 所签文本 | 发送的 toSign | 判定 |
|---|------------|--------------|------|
| 4a | V7（含前缀） | V7 全文（ERP 预加直传，设计现行方案） | 过 → 方案成立 |
| 4b | V1（无前缀） | V1 原文 | 过 → 前缀非网关要求，仅约定俗成 |
| 4c | V1（无前缀） | `LOGONDATA:`+V1（复刻 SDK 内部行为） | **过 = World B 证据（网关不严格比对原文），禁止据此允许「签的字节≠送验原文」的约定**；拒 = 前缀参与网关比对 |

### G5 opType 样本接受性（3 次预算）

同一枚 V1-P7、正确 toSign，换 opType：`登录签名`（基线）/ `业务签署` / `签署回执`。

**判定纪律（审查修订）**：三个值通过只证明**这三个值被接受**（存在性观察），不能推导 opType 可任意填写；部分拒 → opType 有校验，**向厂商索取合法值表**（升级为接入前置问题）。结论一律记「样本通过/拒绝」。

### G6 certValidate 状态语义（独立请求定义）

probe 子命令 `certvalidate`：**表单仅含 `certBase64` 一个字段**（不沿用验签接口四字段；HMAC/表单同源规则同 G1）。对签名证、加密证各一发（凭 S2 的 DER）。记录响应字段与状态枚举值。过期/吊销证书无样本 → 记「未覆盖」，列入厂商索取清单。

### G7 requestId 重复观察（2 次预算）

同一请求（同 requestId/同 P7/同 toSign）连发 2 次，记录响应异同。

**判定纪律（审查修订）**：两次响应相同只算**重复请求观察**——不能证明网关去重、不能证明计费安全、更不能证明超时后重试安全。无论观察结果，**维持附录 §4.2 F.101 的禁止自动重试**；重试策略等厂商书面契约。


## 4. S 组：实盾与本机客户端（Windows + harness 控制台）

前置：`P0.connect()` 成功（log 出现 `ws open`）。容器名获取：`P0.userList()` → `retValue` 形如 `名称||容器名&&&…`（demo 解析逻辑 `certLogin.html:50-79`），记下**全部条目**（S1 判定单盾=1 还是 2 容器）。下文 `<c>` 均指所选容器名。

### S0 版本与环境
```
P0.rawCall('SOF_GetVersion', [])
P0.pinRetry('<c>')                     // 初始剩余次数（只读，不动 PIN）
```

### S1 枚举与证书过滤
```
P0.userList()                          // 原始串全文入档
```
过滤子测试（放最后，粘滞风险）：
```
P0.rawCall('SOFE_SetCertFilter', ['', 'OU=PN:01@XM20250916', 0]).then(()=>P0.userList())
P0.rawCall('SOFE_SetCertFilter', ['', 'OU=PN:99@NOPE', 0]).then(()=>P0.userList())   // 错误项目号→空列表?
P0.rawCall('SOFE_SetCertFilter', ['', '', 0]).then(()=>P0.userList())                 // 重置是否生效
```
判定：过滤语义（前缀/全匹配）、错误值清空后能否恢复。测试盾若非项目绑定型证书，条目不变也如实记录。

### S2 双证书导出（→ fixture + E2 输入）
```
P0.exportSignCert('<c>')   // evidence/S2-sign-cert.b64
P0.exportEncCert('<c>')    // evidence/S2-enc-cert.b64
P0.rawCall('SOF_GetCertInfo', [<签名证b64>, 0])   // type 0..7 逐个试，记录 DN/序列号/有效期字段映射
```
DER 回传 Linux（后续 E1-R2b / E2 / G6 消费）。

### S3 PIN 行为（前置闸 + 只许错一次）

**前置闸（全部满足才允许错误 PIN 测试，否则 NOT_RUN）**：
1. PIN 已按盾随附文档/厂商书面确认（标准发行盾 12345678 有安装须知依据；未经确认不得以默认值试探）；
2. `P0.loginSelected('<c>')` **成功登录**（未缓存 PIN 时自动弹输入框；勿先单独调 `P0.readPin()` 再立即 `loginSelected`——双弹窗）；
3. `P0.pinRetry('<c>')` 读到**可靠的剩余次数 R**，且 **R ≥ 3**。

满足后执行并记录：
```
P0.rawCall('SOF_Login', ['<c>', 'WRONG-PIN-ONCE'])   // 注意：控制台出现明文——推荐改用临时页内变量，见下
P0.lastError(); P0.pinRetry('<c>')
P0.loginSelected('<c>')                               // 立即恢复
P0.pinRetry('<c>')                                    // 恢复后次数是否回满
```
推荐不落明文的等价做法（控制台）：
```
(async () => { const ok = await P0.readPin(); if (!ok) return;
  const pin = 'WRONG-P0-ONCE'; await P0.rawCall('SOF_Login', ['<c>', pin]);
  await P0.lastError(); await P0.pinRetry('<c>'); })()
```
（transport 的 `rec()` 掩码保证 `P0.dump()` 中 PIN 位永远是 `***`；错误 PIN 值本身同理不外泄。）
锁死阈值/PUK：不做，记「未覆盖」。

### S4 ★ 签名向量集（G3/G4/G5 的弹药）

先 `P0.loginSelected(签名容器)` 确保已登录，然后逐条（**字符串含真实控制字符**，控制台原样粘贴——JS 转义 `\n`/`\r\n` 即真实字节）：

| # | 文本（byte 精确） | 控制台调用 | 目的 |
|---|------------------|-----------|------|
| V1 | `SCCA-P0-V1::plain-ascii-0123456789` | `P0.signAttached(c,'SCCA-P0-V1::plain-ascii-0123456789')` | 基线/G3/G5 |
| V2 | `SCCA-P0-V2::中文唱标报价一百零三元整` | `P0.signAttached(c,'SCCA-P0-V2::中文唱标报价一百零三元整')` | 中文 |
| V3 | `SCCA-P0-V3::a&b+c/d=e%f` | `P0.signAttached(c,'SCCA-P0-V3::a&b+c/d=e%f')` | URL 编码敏感字符 |
| V4 | `SCCA-P0-V4::line1\nline2`（真实 LF） | `P0.signAttached(c,'SCCA-P0-V4::line1\nline2')` | 换行 |
| V5 | `SCCA-P0-V5::line1\r\nline2`（真实 CRLF） | `P0.signAttached(c,'SCCA-P0-V5::line1\r\nline2')` | 中间件是否改写 CRLF（干净编码） |
| V6 | `SCCA-P0-V6::emoji😀extB𠀀end` | `P0.signAttached(c,'SCCA-P0-V6::emoji😀extB𠀀end')` | 4 字节 UTF-8 |
| V7 | `LOGONDATA:{"challengeId":"P0-FIXED-CH-001","expiresAt":"2026-10-20T10:00:00Z","nonce":"00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100","portal":"supplier","purpose":"ca-login","signFingerprint":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef","version":1}` | `P0.signAttached(c,'LOGONDATA:{"challengeId":"P0-FIXED-CH-001","expiresAt":"2026-10-20T10:00:00Z","nonce":"00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100","portal":"supplier","purpose":"ca-login","signFingerprint":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef","version":1}')` | G4 登录形态（nonce=64 hex，键序=canonicalJson 排序） |
| V1d | 同 V1 但 detached | `P0.signDetached(c,'SCCA-P0-V1::plain-ascii-0123456789')` | flag=1 是否被中间件接受；detached 形态入档 |

每条记录：`P0.b64(文本)`（我们送入的 InData）、P7 全文、P7 字节长度。**V1/V7 的 P7 与原文单独存文件**（`fixtures/V1.p7.b64`+`V1.txt`、`fixtures/V7.p7.b64`+`V7.txt`，probe 直接消费）。

**附录 E 素材（同场采集）**：另开一页加载 demo 原件 `sccmPlugin.js`，用其自带 `base64Encode` 对 V5 文本签名一次 → `fixtures/V5-demo-enc.p7.b64`（demo 编码吞 `\r` 的负例样本，消耗网关预算 1 次，见附录 E）。

### S5 ★ P7 内嵌原文解析（Linux，离线，p7walk v3）

对 V1–V7、V1d 的 P7 跑 `node p7walk.mjs --p7 <file> --expect "<原文>"`；签名证相关样本再加 `--expectSerial <所选签名证serialHex> --expectCertSha256 <签名证DER sha256>`（取自 S2/E2）。记录与判定：

- contentType 白名单命中（PKCS#7 signedData；GM/T 0010 OID 实样确认后扩充白名单）；
- eContent 三种解释比对：= `UTF8(原文)` / = `Base64 文本` / 无 eContent（detached 形态，仅当 encapContentInfo 严格为 `[OID]`）→ C-8；**任何解析失败或非法形状输出 INCONCLUSIVE，不得判 detached**；
- signerInfos：数量（**必须为 1**）、sid 形态（issuerAndSerial serialHex 或 SKI hex）、digestAlg/sigAlg OID **连同参数子树**、signedAttrs 有无 → C-9；
- **三方指纹闭环（本地两方）**：signer sid serialHex vs `--expectSerial`、`[0]` 证书集 sha256 vs `--expectCertSha256`——「实际签名者证书=本地所选证书」在此闭环；「网关返回证书」一方待 G3 成功样本回填后并入同一矩阵（evidence 三列对齐）；
- V5 的 eContent 是否仍含 `\r\n`（中间件字节忠实性；亦为附录 E-2 的归因依据）；
- V1d：若产出且解析为合法 detached 形态 → 入档（生产端固定只收 flag=0 的依据）。


### S6 ★ 密钥封装往返（dual-v3 kself 可行性 + 封装随机性/算法证据）

```
// ① 固定明文（键序=canonicalJson 排序）×3 次重复封装——同证同明文，密文互异才能证明封装随机性
const W = '{"iv":"fedcba9876543210fedcba9876543210","k":"0123456789abcdef0123456789abcdef"}';
P0.encryptTo(<S2加密证b64>, P0.b64(W))   // → C1a
P0.encryptTo(<S2加密证b64>, P0.b64(W))   // → C1b
P0.encryptTo(<S2加密证b64>, P0.b64(W))   // → C1c   // 三者 P7 必须互异
// ② 往返：任一密文解回
P0.decryptWith('<c>', C1a)               // retValue 与 P0.b64(W) 逐字节比对
// ③ 换明文再往返一轮（功能覆盖）
```
**判定纪律（审查修订）**：随机性观察必须「同证书、完全相同明文」重复封装——**改变 k/iv 后密文不同不构成证据**（v1 此处逻辑作废）。记录：每次密文尺寸（→ 附录 §2.5 限额校准）、耗时、p7walk EnvelopedData 判读结果（接收者 serialHex 是否=加密证、keyEncAlg OID、contentEncAlg OID——**不得从签名 P7 的算法推断密钥包算法**，C-11）。

### S7 用途边界
```
P0.encryptTo(<S2签名证b64>, P0.b64(W))   // 用签名证封装 → 存 C2
P0.decryptWith('<c>', C2)                 // 同容器持双私钥时能否解开
P0.signAttached('<c>', 'probe-usage-boundary')
```
判定：中间件层是否强制加密/签名用途隔离；若全通则隔离责任在 ERP 证书用途校验，写进结论。

### S8 并发与回显（串行设计的实证）
```
// 对照组（绕过队列，复刻 sccmPlugin 的并发行为）：
const w1=new WebSocket('wss://localhost:36171');
w1.onopen=()=>{ w1.send(JSON.stringify({action:'SOF_GetVersion',params:[]}));
                w1.send(JSON.stringify({action:'SOF_GetUserList',params:[]})); };
w1.onmessage=e=>console.log('frame:',e.data);   // 观察回包帧是否带 action 回显、能否区分归属
```
**判定纪律（审查修订）**：`action` 回显（若有）**不是请求关联 ID**——相同命令并发仍无法区分；结论仅记录「回显有无」作通道诊断，**串行设计维持不变**（撤回 v1 的「可并行化」推断）。

### S9 断连/拔插盾
- 关闭证书助手进程 → 任一调用 → 记录错误形态（WSS error/close、retValue 空、lastError 码）→ 重启证书助手 → `P0.connect()` 恢复性；
- 拔盾 → `P0.userList()`（预期空/错误）→ 插回 → **先 `await P0.connect()` 恢复连接** → 重新枚举，然后不重新登录直接 `P0.signAttached('<c>','probe-replug')`——**判定口径**：`QUEUE_INVALIDATED`/连接层错误=请求未达设备（拔盾断连失效旧队列，属通道层），恢复连接重试后再判；仅请求**到达中间件**（收到响应帧或错误码）的结果才判「PIN 登录态是否随拔盾失效」；
- 迟到回包观察：断连前发起慢调用，看 close 后是否还有帧（generation/超时关连接设计的行为验证）。

### S10 多标签登录态归属（冷启动基线 + 矩阵）

顺序：
1. **冷启动基线**：证书助手刚启动、任何页面未登录 → 直接 `P0.signAttached` → 预期失败（证明初始态未登录，避免「假共享」误判）；
2. A、B 两标签页各自 `P0.connect()`；A 页 `P0.loginSelected('<c>')` 成功后，B 页**不登录**直接签名 → 过=进程级共享 / 败=连接级；
3. B 页显式登录 → A 页再签（互踢/共存?）；
4. 关闭 A 页 → B 页再签（页面关闭是否影响他页）；
5. 重启证书助手后重复 2（服务级登录态）；
6. （并入 S9 数据）拔插盾后重复 2。

### S11 ⛁ 双盾互斥（如有第二把）

两盾同插：枚举条目数；A 盾加密证封装的密文用 B 盾容器 `P0.decryptWith`（预期失败）——「错盾指向旧证书」UX 的行为依据。无双盾记「未覆盖」。

### S12 HTTPS→本机 WSS 连通性（生产形态预验）

Linux 生成自签证书起 HTTPS 静态服务（`openssl req -x509 …` + `python3 -c` ssl 包装或 `npx serve --ssl`），Windows 浏览器信任后在 https 页面内 `new WebSocket('wss://localhost:36171')` → `P0` 全流程走一遍。
**判定**：HTTPS 页面连本机 WSS 是否被 CSP/mixed-content/Private Network Access 拦截；**localhost HTTP 测试成功不能代替此项**（主方案 §4 的联调项前移）。记录浏览器版本与拦截提示原文。


## 5. E 组：证书与身份样本（Linux）

### E1 CertData 身份字段——双源拆分记录（C-13）

**审查修订**：CertData 的身份字段（subjectDN/certCN/O/orgNumberOrPersonNumber 等）在 JAR 内是 `X509Certificate.getInstance(certBase64)` 后由 `CertUtils.getCertData()` **从 DER 本地解析**的（`SOFUtils` 中 OID `1.2.156.112646.8` 即企业扩展 OID 线索）——**不等于网关原生返回**。因此分两源记录：

| 源 | 采集方法 | 用途 |
|----|---------|------|
| 源 A：网关原始响应 | G0/G3 的响应体 JSON 全文 | 判定网关原生字段有哪些；「CA 可信返回」只能指这一层 |
| 源 B：JAR 从 DER 本地解析 | G1-R2b（sink 喂真 DER 后 certLogin 返回的 `data`） | 证明 CertData 字段出处=证书 DER（含扩展 OID） |

比对表（入 evidence）：

| 字段 | 源 A 值 | 源 B 值 | openssl 从 DER 独立解析值 | 判定 |
|------|--------|--------|--------------------------|------|
| orgNumberOrPersonNumber | … | … | 扩展 OID 1.2.156.112646.8 内容 | =18 位 USCC？（与 Supplier.creditCode 形态人工比对） |
| busiRegNumber / certSN / hexSerialNumber / subjectDN / O / issueName | … | … | … | certSN vs hexSerialNumber vs DER serialHex（去前导零、大小写） |

**判定纪律**：身份字段「像 18 位信用代码」、双证「同容器/同名称」**均不足以授权绑定**；结论表须记录两证各自的可信身份来源、发行者、用途与配对依据。源 A 无任何身份字段且源 B 的 DER 扩展也无 → 绑定第 4 步身份来源无着落 → **升级厂商问题**（与 G5 opType 表合并索取）。状态检查（certValidate）缺失 → 对应能力阻断，明示。

### E2 本地 DER 解析——仓库解析器仅作兼容性检查，事实以 openssl 提取为准

**审查修订**：仓库 `x509-cert.ts` 解析器限定公钥形态（首 OID+65 字节未压缩）、扩展仅 BasicConstraints（:122-133），不能产出曲线/KeyUsage/EKU 全量事实——定位为「兼容性检查对象」：

1. `openssl x509 -inform DER -in sign.der -text -noout`（enc.der 同）提取：算法/曲线 OID、KeyUsage/EKU、全部扩展 OID 及内容（重点 `1.2.156.112646.8`）、有效期、主体/签发者 DN、serialHex、证书 DER sha256（供 S5 `--expectCertSha256`）；
2. 仓库解析器跑同一 DER（临时 tsx 脚本调 `parseCertificate`——**仓库实际导出名**，`x509-cert.ts:96`；v2 误写为 `parseX509Cert`）：通过/失败点记录 → 附录 §6.1 x509 改造清单输入；
3. openssl 证书事实与 S5 的签名算法 OID 做**兼容组合矩阵**判定（不是数值相同——证书密钥算法与签名算法本就是两个 OID）：SM2 密钥（SPKI `1.2.156.10197.1.301`）× SM3withSM2（`1.2.156.10197.1.501`）、RSA 密钥 × SHA256withRSA（`1.2.840.113549.1.1.11`）等各自为合法组合；**跨组合**（如 SM2 密钥配 RSA 签名）→ 阻断并人工判读 → C-9。


### E3 双证关系汇总

同容器/同主体/异序列号/有效期起止/加密证扩展差异——S1/S2/E2 交叉表（→ CaCertificate 双证绑定设计输入）。

## 6. 记录规范与交付物（v3）

目录分治（**原件与摘要分离**——P7/DER 是被签名的字节，改动任何一位即失去验证价值，不存在「脱敏后仍可验证」的原件）：

```
phase0-evidence/            # 受控目录，整体 .gitignore（或库外存放）
  originals/                # 原件：*.p7.b64 / *.b64 证书 / 网关响应原文 JSON / GW 台账
  G|T|S|E-*.json            # 用例 evidence（脱敏：无 PIN/无凭据/无鉴权值/身份字段按需遮蔽）
  fixtures-symlink 或清单    # 指向 originals 中可复用样本的索引
入库（可提交 git）：仅脱敏 evidence JSON + 结论回填表 + 本文档修订记录
```

evidence 单条 schema（v2，含状态机与调用编号）：

```json
{ "testId": "G3", "callNo": "P0-GW-004", "status": "PASS | FAIL | INCONCLUSIVE | NOT_RUN",
  "ts": "2026-10-13T03:11:22Z",
  "tool": { "name": "probe.mjs", "version": "v2", "node": "v24.16.0" },
  "gatewayCall": { "url": "…9527/…", "opType": "登录签名", "requestId": "p0-…", "resultCode": "…", "latencyMs": 812 },
  "inputs": { "toSignFile": "originals/V1.txt", "toSignBytes": 32, "toSignSha256": "…",
              "p7File": "originals/V1.p7.b64", "p7Bytes": 1834, "p7Sha256": "…" },
  "expected": "通过/拒绝（原因）", "actual": "…",
  "conclusion": "…", "uncovered": [] }
```

- 鉴权原文、鉴权值与完整表单体只进 `<out>.debug.json`（probe v3 自动生成，受控管理）；脱敏 evidence 与入库摘要一律不含。

**结论回填表**：按 §0 的 C-1..C-13 逐行填「结论 / 证据文件 / 回填动作 / 状态」；预期初始未覆盖名单：吊销/过期证书样本、PUK、锁死阈值、第二把盾（若单盾）、生产网关、平板环境。

## 7. 执行顺序与预算台账

```
第0步 离线工具自证（Linux，零外联）：T1 假WS三场景 → T2 p7walk 合成P7 → T3 probe↔JAR 双捕获 diff
第1步 Windows 采集：S0 → S1(无过滤) → S2(DER回传Linux) → S3(前置闸满足才做) → S4(V1..V7/V1d + 附录E素材)
第2步 离线解析与字节固定（Linux）：S5(p7walk) → E2(openssl+仓库解析器) → E1源B(G1-R2b)
第3步 有预算网关正反例（Linux）：G0 → G3 → G4 → G5 → G6 → G7 → 附录E 对照验签
第4步 补充行为采集（Windows）：S6 → S7 → S8 → S9 → S10 → S11(Ⅎ) → S12(HTTPS→WSS)
第5步 汇总：E1/E3 → 结论回填表 C-1..C-13 + 能力与阻断项矩阵
```

网关调用预算台账（每发一次先登记 callNo；预算=23，超限即停）：

| 组 | 次数 | 明细 |
|----|------|------|
| G0 | 3 | 0-a 正常 / 0-b 负对照 /（必要时复验） |
| G3 | 4 | 3a / 3b / 3c / 3a' |
| G4 | 3 | 4a / 4b / 4c（4a 过且 4b 结论明确时可省 4c，省 1 次） |
| G5 | 3 | 三 opType 样本 |
| G6 | 2 | 签名证 / 加密证 |
| G7 | 2 | 重复请求 |
| 附录 E | 2 | transport-P7 复验（应过）/ demo 编码 V5 负例（应拒） |
| 合计 | 19 | 上限 23（+4 余量，含失败重跑） |

**阶段 0 完成声明（审查修订）**：产出=协议实现基线固定 + 算法范围固定 + 适配层（受控通道/双证模型）实现依据 + 能力与阻断项矩阵。**不得据此宣称登录、绑定、投标或开标可用**——门户现仅 `local-sm2` provider（`ukey-factory.ts:34`），真实门户接入、后端资格检查、P7 DTO、双证绑定与 v3 业务闭环按主方案阶段 1-3 另行实施与验收。


## 8. 本机离线执行记录（2026-10-12，v3.1）

T 组与 G1 的全部离线部分已在 Linux 本机实际执行（虚构凭据、本地 sink、零外站；证据存 `phase0-evidence/`）：

| 项 | 结果 | 要点 |
|----|------|------|
| T1 transport v3 | **10/10 PASS** | 超时只关自己的连接；旧 socket 迟到帧只记录不误配；`QUEUE_INVALIDATED` 拒绝排队命令（`SOF_GetUserList` 从未发出）；连接等待 8.0s 超时拒绝；打开前关闭 11ms 立即 reject |
| T2 p7walk v3 | **7/7 符合** | attached 提取 `==UTF8(expect)`；detached 形态识别；**SKI 形态两个算法 OID 均打印**；双签名者；EnvelopedData（keyEncAlg/contentEncAlg+IV 参数）；未知 OID→INCONCLUSIVE；非法 `[1]`→INCONCLUSIVE（exit=2） |
| T3 probe↔JAR | **逐字节等价** | 同清单三向量（中文/`&`/`+`/`/`/`=`/换行、登录形态、**空串**）：body/`app_id`/`signature`/content-type 全等；空串字段**双侧一致省略**（表单+HMAC 同源跳空证实） |
| G1 判定 a/b/c/d/e/f/g | **行为级全部证实** | 路径 `api/signature/verifyPkcs7`（**certLogin 与验签同打此端点**，`certLogin` 专用路径常量未被使用）；表单字段集恰为 4 字段（projectId 不出现）；HMAC=键升序/跳空/仅值 `&` 连接/UTF-8/小写 hex（对捕获复算命中）；`certLogin` 加一次 `LOGONDATA:` 且 opType=登录签名；非 ASCII Secret 本机 JVM=UTF-8（GBK 复算不符） |

执行中修正的两处文档缺陷（已回写本文）：

1. T2 造件脚本 OID 编码 `06 0A`→`06 09`（OID 内容实为 9 字节，`060A` 模式在真实 DER 中不存在、按字面执行必在 assert 失败）；非法件补第二个 SET（否则拦在形状闸而非「非法标签」专属分支）；
2. probe content-type 补 `; charset=UTF-8`（JAR 实发带该后缀；`SccaGatewayClient` 实现必须镜像此头）。

附带行为级新证据（回填结论表/主方案）：

- **CertData 确为 DER 本地解析**：sink 响应中喂入 openssl 自签证书，SDK 解出 certCN/subjectDN/hexSerialNumber/issueName；无对应扩展时 `orgNumberOrPersonNumber=null` → C-13 双源拆分的依据坐实（绑定身份来源必须落在网关原生字段或证书扩展，JAR 包装层不产生新事实）；
- **`certSN=null` 而 `hexSerialNumber` 有值**——主方案 §5「两者含义不同」行为实证；
- 网关假响应 `result_code=0` → SDK 本地包装 `code:"200"`——主方案 §2.4「包装层非判定字段」实证。

**G0 增补（2026-10-12 实网关 2 发，台账 `phase0-evidence/budget-ledger.md`）**：凭据有效确证——正常鉴权+合成 P7 → HTTP 200/`result_code=9998`「签名证书中级证书验证失败」（业务层，且**行为证明 verifyPkcs7 含签名证书链校验**）；负对照 → HTTP 401/`result_code=1003`「参数签名值错误」（鉴权层，类别可区分）。附：响应含文档外 `success` 布尔字段。Windows 采集包已生成并整合为单一操作手册（`~/桌面/ERP/四川CA/phase0-harness.zip`：index.html + transport.js v3.2 + **操作手册-Windows机.md**——吸收原两张操作卡，含拓扑/访问方式 A(LAN)/B(file://)/FAQ；Windows 侧全程零 ERP 依赖）。

**后台复审补丁（v3.2，2026-10-12）**：并行 code-review 报告 7 项，2 项与人工自查重合（S12 SSLContext、双弹窗）已修；新增 5 项核实成立并全部修入——① login 的 GetLastError 加**同连接硬守卫**（失败帧后连接被换/断则不跨连接查询）；② onclose 无条件 settle 本 socket 在途请求（原 `ws!==sock` 早退会让请求空等 20s 且误记 `_timeout`）；③ `b64` 分块转换（大输入 spread 栈溢出，S9 封装大文件场景必踩）；④ S9-2 判定口径修正（`QUEUE_INVALIDATED` 属通道层，不能记作 PIN 态失效）；⑤ 附录E 原件页改为免控制台 PIN 路径（demo 插件自动弹 PIN 框）并补 `await`（WSS 模式返回 Promise，不 await 会 copy 出 "[object Promise]"——人工核查新发现）。回归：T1 10/10 + 新增 T1-e（断连 303ms 立即 settle）/T1-f（readPin 单飞）全过。

**第 4/5 步执行记录（2026-10-13，实盾+真网关）**：Windows 采集完成（p0/ 目录 24 文件；含 5 项行为级发现——过滤不生效/PIN 计数复位/detached 支持/双证同容器/WSS 自签证书）。离线链全过：S5（C-8 原始 UTF-8 字节、C-9 SM3+SM2 国密、三方指纹本地两方、demo 吞 \r 实锤）、E2/E3（SM2 曲线、KeyUsage 硬隔离、OCSP/CRL/中间证 URL、仓库解析器兼容 PASS）、E1-R2b（三套编号体系定案）。**判决链（P0-GW-003..015，台账 15/23）**：G3=**World B**（网关不比对 toSign——本地 attached-P7 原文比对是唯一原文绑定，P0-1 消解路径成立且必要）；G4 前缀纯约定；G5 opType 3 样本过；G7 重复观察（维持禁自动重试）；E-2 World B 佐证；G6 certValidate 403/1105 未授权→状态检查能力阻断（备选=证书自带 OCSP/CRL，列厂商清单）。三方指纹闭环完成（本地所选证=P7 签名者=网关返回 serialNumber）。结论回填表：`phase0-evidence/结论回填表.md`。

**第 6 步执行记录（2026-10-13，p02 第二轮回传）——阶段 0 收官**：S6 **GM/T 0010 SM2 信封定案**（keyEnc=SM2 …301.3、contentEnc=**SM4-ECB** …104.1、接收者=加密证指纹闭环、同证同明文三封装互异=新鲜 CEK、密钥包实测 ≈460B）；S7 中间件**强制分钥**（签名证封装可成、同容器解密拒 184549377）；S8 响应无回显→FIFO 串行唯一安全；S9 助手=Windows 服务+看门狗 3s 拉活、**拔盾清登录态**、**2MB 加密全局阻塞 ~45s=本地 DoS 面（适配器红线：禁同步大报文）**；S10 **登录态=进程级共享**（跨连接/跨页面/共存/关页存活/服务重启失效）——任何本地网页可复用登录态签名→服务端挑战绑定是信任根；S11 双盾并存+错盾码；S12 HTTPS→WSS ✅（①24ms/③9ms/②明文被 mixed-content 拦；经无头 Edge+cert-ignore 执行，PNA/mixed-content 结论有效，WSS 证书常规信任待 headed 复跑可选闭环）。终版结论：`phase0-evidence/结论回填表.md`（C-1..C-13：11 PASS/2 PASS*/1 BLOCKED）+ `能力与阻断项矩阵.md`（8 放行/2 阻断：证书状态在线检查、可信时间戳）。

剩余：仅未覆盖清单项（过期/吊销样本、PUK、生产凭据、certValidate 权限、S12 headed 复跑可选）——均不阻塞主方案阶段 1 启动。

## 附录 A：测试台源码

### A.1 transport.js（受控 WSS 通道 v3.2）

```js
// P0 受控通道 v3 —— sccmPlugin.js WSS 协议的镜像原型（仅阶段0测试台）
// 协议事实（对 sccmPlugin.js 逐行核对）：
//  · WSS: wss://localhost:36171（:2）；请求 {action, params} → 响应 JSON 取 .retValue
//  · WSS 模式 encodeURIFun = 恒等（:1738-1746），容器名原样传
//  · retValue 为空串 = 失败 → SOF_GetLastError 取码（:383-413 getMessage 模式）
//  · 无请求关联 ID（:313-328 每 req 覆盖 onmessage）→ FIFO 队列串行根治
// v3 修订（外部审查二轮 2026-10-12，四个缺陷全修）：
//  · 每个请求固定自己的 socket 与 generation：detach/timeout 只操作捕获的 sock——
//    超时关连接不会再殃及后来重建的新连接（v2 读全局 ws 的缺陷）
//  · connect() 设 8s 连接等待超时；打开前关闭/出错必须 reject——等待 Promise 不悬空（v2 缺陷）
//  · 断连立即 settle 在途请求（_connErr）并 queueEpoch++：旧队列整体失效，
//    已排队未发出的命令一律 QUEUE_INVALIDATED 拒绝——绝不跨连接自动续发签名/解密（v2 缺陷）
//  · 登录复合动作仅在「收到真实失败响应帧」时同连接查 GetLastError；
//    _timeout 直接抛错不重连查询——新连接上没有原连接的错误状态（v2 缺陷）
//  · 其余保持：超时=摘监听+关自己的连接+换代次；action 回显不匹配不消费；PIN 掩码+密码控件
// v3.2（后台复审补丁）：
//  · login 的 GetLastError 加同连接硬守卫（失败帧后连接若被换/断，不再跨连接查询）
//  · onclose 无条件 settle 本 socket 在途请求（原 ws!==sock 早退会让请求空等 20s）
//  · b64 分块转换（大输入 spread 会栈溢出）；readPin 单飞（防叠窗）
(function () {
  const WS_URL = 'wss://localhost:36171';
  const OP_TIMEOUT_MS = 20000;
  const CONNECT_TIMEOUT_MS = 8000;
  const PIN_PARAM_IDX = { SOF_Login: [1], SOF_ChangePassWd: [1, 2], SOFE_UnblockPassWd: [1, 2] };

  const log = [];
  let ws = null, gen = 0, connectP = null, active = null, pinCache = null;
  let queue = Promise.resolve();
  let queueEpoch = 0;                       // 断连/超时失效旧队列的代次

  function rec(kind, tag, payload) { log.push({ ts: new Date().toISOString(), kind, tag, ...payload }); }
  function maskParams(action, params) {
    const idx = PIN_PARAM_IDX[action];
    return idx ? params.map((p, i) => (idx.includes(i) ? '***' : p)) : params;
  }
  function failActive(reason) {             // 断连：settle 在途请求并使旧队列失效
    if (active) { const a = active; active = null; queueEpoch++; a.fail(new Error(reason)); }
    else queueEpoch++;
  }

  function connect() {
    if (ws && ws.readyState === 1) return Promise.resolve({ sock: ws, gen });
    if (connectP) return connectP;
    const myGen = ++gen;
    connectP = new Promise((res, rej) => {
      const sock = new WebSocket(WS_URL);
      ws = sock;
      const st = { done: false };
      const ct = setTimeout(() => {                        // 连接等待超时——Promise 不悬空
        if (st.done) return; st.done = true; connectP = null;
        if (ws === sock) ws = null;
        try { sock.close(); } catch (e) {}
        rej(new Error('WSS 连接超时（8s）：证书助手未响应'));
      }, CONNECT_TIMEOUT_MS);
      const openDone = () => { if (st.done) return; st.done = true; clearTimeout(ct); connectP = null; res({ sock, gen: myGen }); };
      const failDone = (msg) => { if (st.done) return; st.done = true; clearTimeout(ct); connectP = null; if (ws === sock) ws = null; rej(new Error(msg)); };
      sock.onopen = () => { if (ws === sock) { rec('ws', 'open', { gen: myGen }); openDone(); } else { try { sock.close(); } catch (e) {} } };
      sock.onerror = () => { if (ws === sock) { rec('ws', 'error', { gen: myGen }); failDone('WSS 连接失败：证书助手未安装/未启动/被浏览器拦截'); } };
      sock.onclose = () => {
        rec('ws', 'close', { gen: myGen });
        if (active && active.sock === sock) failActive('连接已断开（WSS close）');   // 本 socket 的在途请求立即 settle（即使 ws 已换新）
        if (ws === sock) { ws = null; queueEpoch++; }                                 // 当前连接断了才失效队列
        connectP = null;
        failDone('连接在打开前关闭');                                                  // st.done 守卫：已 open 则 no-op
      };
      sock.onmessage = (ev) => { if (!active) rec('ws', 'late-frame', { gen: myGen, data: String(ev.data) }); };
    });
    return connectP;
  }

  async function doCall(action, params) {   // 仅在队列内执行；请求固定自己的 sock/gen
    const { sock, gen: myGen } = await connect();
    if (gen !== myGen || !ws || ws !== sock || sock.readyState !== 1) throw new Error('连接代次失效 gen=' + myGen + '/' + gen);
    const frame = JSON.stringify({ action, params });
    rec('req', action, { params: maskParams(action, params), gen: myGen });
    return await new Promise((res, rej) => {
      let timer = null;
      const onMsg = (ev) => {
        if (gen !== myGen || ws !== sock) { rec('ws', 'stale-frame-dropped', { gen: myGen }); return; }
        let j = null;
        try { j = JSON.parse(ev.data); } catch (e) { finish({ retValue: undefined, _malformed: true }); rec('resp', action, { malformed: String(ev.data) }); return; }
        if (j && typeof j.action === 'string' && j.action !== action) { rec('ws', 'unmatched-frame', { expect: action, got: j.action }); return; }
        rec('resp', action, { gen: myGen, retValue: j && j.retValue, retCode: j && j.retCode });
        if (j && typeof j === 'object') j._sock = sock;   // 供 login 的同连接 GetLastError 守卫（不进日志）
        finish(j);
      };
      const finish = (val) => { clearTimeout(timer); sock.removeEventListener('message', onMsg); if (active && active.onMsg === onMsg) active = null; res(val); };
      const timeout = () => {              // 只关闭本请求的连接；换代次；失效旧队列
        if (active && active.onMsg === onMsg) active = null;
        clearTimeout(timer); sock.removeEventListener('message', onMsg);
        if (ws === sock) { ws = null; gen++; queueEpoch++; }
        try { sock.close(); } catch (e) {}
        rec('resp', action, { timeout: true, gen: myGen });
        res({ retValue: '', _timeout: true });
      };
      timer = setTimeout(timeout, OP_TIMEOUT_MS);
      active = { onMsg, sock, fail: (e) => { clearTimeout(timer); sock.removeEventListener('message', onMsg); active = null; rec('resp', action, { connErr: true, gen: myGen }); rej(e); } };
      sock.addEventListener('message', onMsg);
      sock.send(frame);                      // readyState===1 已验
    });
  }

  function enqueue(fn) {
    const epoch = queueEpoch;                        // 入队时捕获队列代次
    const run = queue.then(async () => {
      if (epoch !== queueEpoch) throw new Error('QUEUE_INVALIDATED：连接已超时/断开——请显式重新发起（含重新登录），不自动续发');
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function login(container, pin) {            // 复合队列动作：仅同连接内查错误码
    return enqueue(async () => {
      const r = await doCall('SOF_Login', [container, pin]);
      if (!r.retValue || r.retValue === 'false' || r.retValue === false) {
        // 同连接硬守卫：仅当失败帧来自本 socket 且该 socket 仍是当前 OPEN 连接时才查错误码；
        // 否则（超时/坏帧/连接已被换）直接抛错——新连接上没有原连接的错误状态
        if (r._timeout || r._malformed || !r._sock || r._sock.readyState !== 1 || ws !== r._sock) {
          throw new Error('SOF_Login 连接层失败或连接已变化——不重连查询错误码');
        }
        const e = await doCall('SOF_GetLastError', []);   // 同一连接、同一队列动作（守卫已证未换连接）
        throw new Error('SOF_Login 失败（lastError=' + e.retValue + '；PIN 不入日志）');
      }
      return r.retValue;
    });
  }

  let readPinPending = null;
  function readPin() {                                 // 密码控件——PIN 不进控制台命令、不进 log；单飞：弹窗未决时复用同一 Promise（防叠窗）
    if (readPinPending) return readPinPending;
    readPinPending = new Promise((resolve) => {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99999';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;padding:16px;border-radius:8px;font:14px/1.6 sans-serif;color:#111';
      box.textContent = '请输入 U盾 PIN（仅存本页内存，用后即清，不写入任何日志）';
      const input = document.createElement('input');
      input.type = 'password'; input.style.cssText = 'display:block;margin:8px 0;width:240px';
      const ok = document.createElement('button'); ok.textContent = '确定';
      const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.style.marginLeft = '8px';
      box.append(input, ok, cancel); div.append(box); document.body.append(div);
      const done = (v) => { input.value = ''; pinCache = v ?? null; div.remove(); };
      ok.onclick = () => { if (input.value) { done(input.value); resolve(true); } };
      cancel.onclick = () => { done(null); resolve(false); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.onclick(); });
      input.focus();
    });
    const clear = () => { readPinPending = null; };
    readPinPending.then(clear, clear);
    return readPinPending;
  }
  async function loginSelected(container) {
    if (!pinCache) { const ok = await readPin(); if (!ok) throw new Error('未输入 PIN'); }
    const pin = pinCache; pinCache = null;           // 用后即清
    return login(container, pin);
  }

  const b64 = (s) => {   // 干净编码：不改 CRLF、支持 4 字节 UTF-8；分块防大输入 spread 栈溢出
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(bin);
  };

  window.P0 = {
    connect, b64, login, loginSelected, readPin, log,
    dump: () => JSON.stringify(log, null, 2),
    rawCall: (a, p) => enqueue(() => doCall(a, p)),
    userList: () => enqueue(() => doCall('SOF_GetUserList', [])),
    lastError: () => enqueue(() => doCall('SOF_GetLastError', [])),
    pinRetry: (c) => enqueue(() => doCall('SOF_GetPinRetryCount', [c])),
    exportSignCert: (c) => enqueue(() => doCall('SOF_ExportUserCert', [c])),
    exportEncCert: (c) => enqueue(() => doCall('SOF_ExportExChangeUserCert', [c])),
    signAttached: (c, text) => enqueue(() => doCall('SOFE_SignPKCS7Message', [0, c, b64(text)])),
    signDetached: (c, text) => enqueue(() => doCall('SOFE_SignPKCS7Message', [1, c, b64(text)])),
    encryptTo: (certB64, dataB64) => enqueue(() => doCall('SOF_EncryptData', [certB64, dataB64])),
    decryptWith: (c, p7b64) => enqueue(() => doCall('SOF_DecryptData', [c, p7b64])),
  };
})();
```


### A.2 index.html（v2：脚本置于 body 末尾，DOMContentLoaded 保证）

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>SCCA P0 Harness</title></head>
<body>
<pre id="p0log" style="position:fixed;inset:0;margin:0;padding:8px;font:12px/1.5 monospace;background:#111;color:#9f9;overflow:auto"></pre>
<script src="transport.js"></script>
<script>
  // v2：脚本在 body 末尾执行，document.body 必然存在（v1 在 head 内执行会抛 TypeError 中断）
  const pre = document.getElementById('p0log');
  const _p = console.log;
  console.log = (...a) => { _p(...a); pre.textContent += a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch (e) { return '[?]'; } }).join(' ') + '\n'; };
  P0.connect()
    .then(() => console.log('[harness] 已连接——按 §4 用例执行；PIN 一律经 P0.readPin()/P0.loginSelected()；最后 P0.dump() 导出'))
    .catch((e) => console.log('[harness] ' + e.message));
</script>
</body>
</html>
```

### A.3 fake-ws.js（v3：T1 工具自证用，先于 transport.js 加载并注入 `window.WebSocket`）

```js
// v3 修订：instances 注册表（可向旧/新 socket 分别注入帧）；emit 同时派发 addEventListener
// 监听器与 onmessage 属性（与真实 WebSocket 一致——v2 只派发监听器，late-frame 路径测不到）；
// closeBeforeOpen / failOpen 注入连接层故障。
class FakeWS {
  static openDelay = 50;
  static failOpen = false;         // true：触发 onerror+onclose，不 open
  static closeBeforeOpen = false;  // true：打开前 onclose（T1-d）
  static instances = [];
  static script = [];              // 元素: (sock, sentFrame) => void，内部可 sock.emit('message', {data})
  constructor(url) {
    this.url = url; this.readyState = 0; this._l = new Map(); this.lastSent = null;
    FakeWS.instances.push(this);
    if (FakeWS.closeBeforeOpen) { setTimeout(() => { this.readyState = 3; this.onclose && this.onclose(); }, 10); return; }
    setTimeout(() => {
      if (FakeWS.failOpen) { this.onerror && this.onerror(new Event('error')); this.readyState = 3; this.onclose && this.onclose(); return; }
      this.readyState = 1; this.onopen && this.onopen();
    }, FakeWS.openDelay);
  }
  addEventListener(t, fn) { if (!this._l.has(t)) this._l.set(t, []); this._l.get(t).push(fn); }
  removeEventListener(t, fn) { const a = this._l.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  send(data) { this.lastSent = data; const act = FakeWS.script.shift(); if (act) setTimeout(() => act(this, data), 0); }
  close() { if (this.readyState === 3) return; this.readyState = 3; const cb = this.onclose; this.onclose = null; cb && cb(); }
  emit(t, ev) {
    for (const fn of this._l.get(t) ?? []) fn(ev);
    if (t === 'message' && this.onmessage) this.onmessage(ev);
  }
}
window.FakeWS = FakeWS;
window.WebSocket = FakeWS;   // 注入（仅 T1 测试页）
```


## 附录 B：网关探针 probe.mjs（v3）

```js
// 用法（凭据走环境变量 SCCA_BASE_URL/SCCA_APP_ID/SCCA_APP_SECRET，不入库；真实网关必须先登记 P0-GW-NNN）：
//   node probe.mjs verify  --callNo P0-GW-004 --opType 登录签名 --requestId p0-g3a \
//                          --p7 originals/V1.p7.b64 --toSignFile V1.txt --out evidence/G3-3a.json
//   node probe.mjs verify  --badSignature ...                      （G0 负对照：确定性错误鉴权值）
//   node probe.mjs certvalidate --callNo P0-GW-017 --cert originals/S2-sign-cert.b64   （G6：表单仅 certBase64）
//   SCCA_BASE_URL=http://127.0.0.1:9331 node probe.mjs verify ...  （T3 工具自证：打本地 sink，不强制编号）
// v3 修订（外部审查二轮）：
//  · 参数解析拒绝「值以 -- 开头」/重复参数/缺值（v2 缺陷：--out --badSignature 后者被吞成文件名→负对照实发正常鉴权）
//  · 非 localhost 调用缺 --callNo 或 --out 直接退出（v2 只标注不拦截）
//  · 响应按字节流式限读（res.body.getReader，超 256KiB 即断开记 truncated）——v2 的 text.slice 按字符截断
//    且在全量读入后才生效；计时器覆盖「响应头+body 读取」全程
//  · hmacPlain/hmacSignature 只写 <out>.debug.json（受控），脱敏 evidence 不含
import crypto from 'node:crypto';
import fs from 'node:fs';

const TIMEOUT_MS = 15000, MAX_RESP_BYTES = 256 * 1024;
const ARG_DEFS = { callNo: 's', opType: 's', requestId: 's', p7: 's', toSignFile: 's', cert: 's', out: 's', path: 's', badSignature: 'b', allowUnnumbered: 'b' };
const opts = {}; const cmds = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { cmds.push(a); continue; }
  const name = a.slice(2);
  if (!(name in ARG_DEFS)) { console.error('未知参数 --' + name + '（白名单: ' + Object.keys(ARG_DEFS).join(', ') + '）'); process.exit(2); }
  if (name in opts) { console.error('重复参数 --' + name); process.exit(2); }
  if (ARG_DEFS[name] === 'b') opts[name] = true;
  else {
    const v = process.argv[++i];
    if (v == null || v.startsWith('--')) { console.error('--' + name + ' 缺值或值以 -- 开头（若是布尔开关请检查拼写）'); process.exit(2); }
    opts[name] = v;
  }
}
const cmd = cmds[0];
if (!['verify', 'certvalidate'].includes(cmd)) { console.error('用法: probe.mjs verify|certvalidate [--callNo --opType --requestId --p7 --toSignFile --cert --out --path --badSignature --allowUnnumbered]'); process.exit(2); }

const BASE = (process.env.SCCA_BASE_URL || '').replace(/\/+$/, '');
const ID = process.env.SCCA_APP_ID, SEC = process.env.SCCA_APP_SECRET;
if (!BASE || !ID || !SEC) { console.error('缺环境变量 SCCA_BASE_URL/SCCA_APP_ID/SCCA_APP_SECRET'); process.exit(1); }

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(BASE);
if (!isLocal && !(opts.callNo && opts.out) && !opts.allowUnnumbered) {
  console.error('真实网关调用必须提供 --callNo 与 --out（登记预算台账+落证据）；本地 sink 不受限');
  process.exit(2);
}

let params;
if (cmd === 'certvalidate') params = { certBase64: fs.readFileSync(opts.cert, 'utf8').trim() };
else params = {
  opType: opts.opType ?? '登录签名',
  requestId: opts.requestId ?? 'p0-' + Date.now(),
  signedData: fs.readFileSync(opts.p7 ?? 'originals/V1.p7.b64', 'utf8').trim(),
  toSign: fs.readFileSync(opts.toSignFile ?? 'V1.txt', 'utf8'),
};

// 表单与 HMAC 同源：同一份「键排序 + 去空」字段集（G1/T3-c 证实 JAR 表单侧同样省略空值）
const entries = Object.keys(params).sort().filter(k => params[k] != null && params[k] !== '').map(k => [k, params[k]]);
const plain = entries.map(([, v]) => v).join('&');
let signature = crypto.createHmac('sha1', Buffer.from(SEC, 'utf8')).update(plain, 'utf8').digest('hex');
if (opts.badSignature) signature = crypto.createHmac('sha1', 'wrong-key-negative-control').update(plain, 'utf8').digest('hex');

const url = BASE + (opts.path ?? (cmd === 'certvalidate' ? '/api/signature/certValidate' : '/api/signature/verifyPkcs7'));
const body = new URLSearchParams(entries).toString();

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const ev = {
  callNo: opts.callNo ?? '(local)', cmd, ts: new Date().toISOString(), url,
  opType: params.opType ?? '(certValidate)', requestId: params.requestId ?? '-',
  inputDigest: {
    toSignBytes: Buffer.byteLength(params.toSign ?? '', 'utf8'), toSignSha256: params.toSign ? sha(params.toSign) : null,
    p7Bytes: params.signedData ? Buffer.byteLength(params.signedData, 'utf8') : null, p7Sha256: params.signedData ? sha(params.signedData) : null,
    certBytes: params.certBase64 ? Buffer.byteLength(params.certBase64, 'utf8') : null,
  },
  signatureSent: opts.badSignature ? 'NEGATIVE-CONTROL' : 'valid',
};
const dbg = { hmacPlain: plain, hmacSignature: signature, formBody: body };   // 只进 debug 文件

let timer = null;
const t0 = Date.now();
try {
  const ctl = new AbortController();
  timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);            // 覆盖响应头+body 全程
  const res = await fetch(url, { method: 'POST', headers: { app_id: ID, signature, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body, signal: ctl.signal }); // charset 后缀=JAR 实测行为（§8）
  ev.httpStatus = res.status;
  const reader = res.body.getReader();                          // 按字节流式限读
  let received = 0; const chunks = []; let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESP_BYTES) { truncated = true; break; }
      chunks.push(Buffer.from(value));
    }
  } catch (e) { if (!truncated) throw e; }
  if (truncated) { try { await reader.cancel(); } catch (e) {} }
  clearTimeout(timer); timer = null;
  ev.latencyMs = Date.now() - t0; ev.respBytes = received; ev.respTruncated = truncated;
  ev.body = Buffer.concat(chunks).toString('utf8');
} catch (e) {
  if (timer) clearTimeout(timer);
  ev.error = String(e); ev.latencyMs = Date.now() - t0;
}
console.log('HTTP ' + (ev.httpStatus ?? 'ERR') + ' ' + (ev.latencyMs ?? 0) + 'ms resp=' + (ev.respBytes ?? '-') + 'B' + (ev.respTruncated ? ' [TRUNCATED]' : '') + '\n' + (ev.body ?? ev.error));
if (opts.out) {
  fs.writeFileSync(opts.out, JSON.stringify(ev, null, 2));                                    // 脱敏 evidence
  fs.writeFileSync(opts.out.replace(/\.json$/, '') + '.debug.json', JSON.stringify({ ...ev, ...dbg }, null, 2));  // 受控 debug
} else console.log(JSON.stringify(ev, null, 2));
```


## 附录 C：SDK 字节捕获（本地 sink，零外联）

### C.1 sink.py（v2：可注入真 DER 供 R2b）

```python
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

# G1-R2b 用：export P0_CERT_B64=$(tr -d '\n' < S2-sign-cert.b64) 后重启 sink，
# certLogin 的响应解析即可走通，返回 JSON 的 data 即 JAR 从 DER 本地解析的 CertData（E1 源 B）。
CERT = os.environ.get('P0_CERT_B64', 'MIIB')

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); body = self.rfile.read(n)
        print(json.dumps({'path': self.path, 'headers': dict(self.headers),
                          'body': body.decode('utf-8', 'replace')}, ensure_ascii=False), flush=True)
        resp = json.dumps({'result_code': '0', 'result_msg': 'OK',
                           'body': {'certBase64': CERT}}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(resp)))
        self.end_headers(); self.wfile.write(resp)
    def log_message(self, *a): pass

HTTPServer(('127.0.0.1', 9331), H).serve_forever()
```

### C.2 SccaCapture.java（v3：清单驱动，T3/G1 共用）

```java
// 运行：java -cp "<sccm-JAY>/WEB-INF/lib/*" SccaCapture.java t3-manifest.json
// 凭据/输入全部取自清单（虚构，baseUrl 指向本地 sink）——零外联；与 probe 读同一份清单（T3 等价性前提）。
import cn.com.scca.signgw.api.SccaGwSDK;
import org.codehaus.jackson.map.ObjectMapper;
import java.io.File;
import java.nio.file.*;
import java.util.*;

public class SccaCapture {
  static String read(String p) throws Exception { return new String(Files.readAllBytes(Paths.get(p)), "UTF-8"); }
  public static void main(String[] args) throws Exception {
    ObjectMapper om = new ObjectMapper();
    Map m = om.readValue(new File(args[0]), Map.class);
    String baseUrl = (String) m.get("baseUrl"), appId = (String) m.get("appId"), secret = (String) m.get("appSecret");
    SccaGwSDK.init(baseUrl, appId, secret);
    for (Object r0 : (List) m.get("runs")) {
      Map r = (Map) r0;
      String id = (String) r.get("id");
      try {
        if (r.containsKey("secretOverride")) SccaGwSDK.init(baseUrl, appId, (String) r.get("secretOverride")); // g1-r3 非 ASCII
        String toSign = read((String) r.get("toSignFile"));
        String p7 = read((String) r.get("p7File")).trim();
        String out;
        if ("certLogin".equals(r.get("kind"))) {                                  // g1-r2：LOGONDATA 前缀证据
          out = SccaGwSDK.certLogin("projP0", toSign, p7, (String) r.get("requestId"));
        } else {
          Object opType = r.get("opType");                                        // t3-d 可为 null——观测 JAR 行为
          out = SccaGwSDK.validateSignaturePkcs7("projP0", toSign, p7, (String) opType, (String) r.get("requestId"));
        }
        System.out.println("RUN " + id + " => " + out);
      } catch (Exception e) {
        System.out.println("RUN " + id + " => EXC " + e.getClass().getName() + ": " + e.getMessage());
      }
    }
  }
}
```

SDK 在 sink 假响应的解析阶段抛错属预期——请求字节已捕获（G1 判定只看请求）；R2b（sink 注入真 DER）后 certLogin 可完整走通。sink 捕获含完整请求头与表单体，T3 与 probe 捕获逐 run diff。


## 附录 D：P7 结构解析器 p7walk.mjs（v3）

```js
// 用法：node p7walk.mjs --p7 originals/V1.p7.b64 --expect "<原文>" \
//                        --expectSerial <serialHex> --expectCertSha256 <sha256>
//       node p7walk.mjs --p7 originals/W1.p7.b64                 （EnvelopedData 密钥包判读）
// v3 修订（外部审查二轮）：
//  · contentType 白名单（PKCS#7 signedData/envelopedData；GM/T 0010 OID 实样确认后扩充）——
//    未知 OID 一律 INCONCLUSIVE（v2 按 SET 数猜测导致误判）
//  · encapContentInfo 严格形状：仅 [OID]（detached）或 [OID,[0]→单一 OCTET STRING]；
//    含非法标签（如 [1]）→ INCONCLUSIVE，绝不判 detached
//  · sid 区分 issuerAndSerial 与 SKI（含 [0] 隐式 0x80 形态）——v2 对 SKI 漏报摘要算法
//  · 算法 SEQUENCE 连参数子树打印；[0] 证书集逐张 sha256+serialHex；
//    --expectSerial/--expectCertSha256 做「实际签名者=本地所选证书」指纹闭环
//  · 多签名者循环；T2 七类合成样本（含未知 OID/非法结构）先行自证
import fs from 'node:fs';
import crypto from 'node:crypto';

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null; };
const der = Buffer.from(fs.readFileSync(arg('p7'), 'utf8').trim(), 'base64');
const expect = arg('expect');
const expectSerial = arg('expectSerial') ? arg('expectSerial').toLowerCase().replace(/^0+(?=.)/, '') : null;
const expectCertSha = arg('expectCertSha256') ? arg('expectCertSha256').toLowerCase() : null;
if (der.length > 2 * 1024 * 1024) { console.log('INCONCLUSIVE: DER 超过 2MiB 边界'); process.exit(2); }

const KNOWN = { '1.2.840.113549.1.7.2': 'signedData', '1.2.840.113549.1.7.3': 'envelopedData',
  '1.2.156.10197.6.1.4.2.3': 'envelopedData' /* GM/T 0010 SM2 数字信封——S6 实样确认（2026-10-13）*/ };

function children(buf) {
  const out = []; let i = 0;
  while (i < buf.length) {
    const start = i; const tag = buf[i]; let len = buf[i + 1], hdr = 2;
    if (len & 0x80) { const n = len & 0x7f; if (n === 0 || n > 4 || i + 2 + n > buf.length) throw new Error('TLV 长度非法 @' + i); len = buf.readUIntBE(i + 2, n); hdr = 2 + n; }
    if (i + hdr + len > buf.length) throw new Error('TLV 越界 @' + i);
    out.push({ tag, len, value: buf.subarray(i + hdr, i + hdr + len), abs: buf.subarray(start, start + hdr + len) });
    i += hdr + len;
  }
  return out;
}
function oid(b) { let v = 0, p = [], first = true; for (const c of b) { v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) { if (first) { p.push(Math.floor(v / 40), v % 40); first = false; } else p.push(v); v = 0; } } return p.join('.'); }
const T = (t) => '0x' + t.toString(16).padStart(2, '0');
const hex0 = (b) => { const s = b.toString('hex'); const t = s.replace(/^0+(?=.)/, ''); return (t.length % 2 ? '0' + t : t).toLowerCase(); };
const paramsHex = (seq) => children(seq.value).filter((c) => c.tag !== 0x06).map((c) => c.abs.toString('hex')).join(',') || '(无)';
const skel = (buf, d) => { if (d > 3) return; for (const c of children(buf)) { console.log('  '.repeat(d) + T(c.tag) + ' len=' + c.len); if ([0x30, 0x31, 0xa0, 0xa1].includes(c.tag)) { try { skel(c.value, d + 1); } catch (e) { console.log('  '.repeat(d + 1) + '(子层解析失败:' + e.message + ')'); } } } };
const bail = (msg) => { console.log('INCONCLUSIVE: ' + msg); try { console.log('—— 顶层骨架 ——'); skel(der, 0); } catch (e) {} process.exit(2); };

try {
  console.log('DER ' + der.length + ' bytes');
  const root = children(der);
  if (root.length !== 1 || root[0].tag !== 0x30) bail('顶层不是单一 SEQUENCE（ContentInfo）');
  const ci = children(root[0].value);
  const typeNode = ci.find((c) => c.tag === 0x06);
  const ctx = ci.find((c) => c.tag === 0xa0);
  if (!typeNode) bail('无 contentType OID');
  const typeOid = oid(typeNode.value);
  console.log('contentType OID:', typeOid, KNOWN[typeOid] ? '(' + KNOWN[typeOid] + ')' : '');
  if (!KNOWN[typeOid]) bail('contentType 不在白名单（PKCS#7 signedData/envelopedData）——确认新 OID 后扩充白名单');
  if (!ctx) bail('ContentInfo 无 [0] content——结构不完整');

  const kids = children(children(ctx.value)[0].value);
  console.log('主体 children:', kids.map((c) => T(c.tag) + '(' + c.len + ')').join(' '));

  if (KNOWN[typeOid] === 'signedData') {
    const version = kids.find((c) => c.tag === 0x02);
    const sets = kids.filter((c) => c.tag === 0x31);
    const seqs = kids.filter((c) => c.tag === 0x30);
    if (!version || sets.length < 2 || !seqs[0]) bail('signedData 形状不符（期望 version + 2×SET + encapContentInfo）');
    const ec = children(seqs[0].value);
    const ecOid = ec.find((c) => c.tag === 0x06);
    const ecCtx = ec.find((c) => c.tag === 0xa0);
    const ecOther = ec.filter((c) => c.tag !== 0x06 && c.tag !== 0xa0);
    if (!ecOid) bail('encapContentInfo 无 eContentType OID');
    console.log('eContentType:', oid(ecOid.value));
    if (ecOther.length > 0) bail('encapContentInfo 含非法标签 ' + ecOther.map((c) => T(c.tag)).join(',') + '——不判 detached');
    if (!ecCtx) console.log('encapContentInfo 仅 [OID] → 无内嵌原文（detached 形态）——生产端固定只收 flag=0');
    else {
      const inner = children(ecCtx.value);
      if (inner.length !== 1 || inner[0].tag !== 0x04) bail('eContent [0] 内非单一 OCTET STRING');
      const raw = inner[0].value;
      console.log('eContent ' + raw.length + ' bytes as-utf8: ' + JSON.stringify(raw.toString('utf8')));
      if (expect != null) {
        const e = Buffer.from(expect, 'utf8');
        console.log('  == UTF8(expect) :', raw.equals(e));
        console.log('  == b64(expect)  :', raw.toString('utf8').trim() === e.toString('base64'));
      }
    }
    const certsNode = kids.find((c) => c.tag === 0xa0);            // 证书集（跳过 encapContentInfo 检查里的 [0] 语境）
    if (certsNode) {
      children(certsNode.value).filter((c) => c.tag === 0x30).forEach((cc, i) => {
        const csha = crypto.createHash('sha256').update(cc.abs).digest('hex');
        const tbs = children(cc.value)[0];
        const sn = tbs ? children(tbs.value).find((n) => n.tag === 0x02) : null;
        console.log(' cert[' + i + '] sha256=' + csha + ' serialHex=' + (sn ? hex0(sn.value) : '?'));
        if (expectCertSha) console.log('   expectCertSha256 match:', csha === expectCertSha);
      });
    } else console.log('（[0] 证书集缺席）');
    const signers = children(sets[sets.length - 1].value);
    console.log('signerInfos: ' + signers.length);
    for (const [i, s] of signers.entries()) {
      const si = children(s.value);
      console.log(' signer[' + i + ']:', si.map((c) => T(c.tag) + '(' + c.len + ')').join(' '));
      const vi = si.findIndex((c) => c.tag === 0x02);
      const rest = si.slice(vi + 1);                               // version 之后
      if (rest[0] && rest[0].tag === 0x30) {                       // issuerAndSerialNumber
        const serial = children(rest[0].value).find((n) => n.tag === 0x02);
        const sh = serial ? hex0(serial.value) : '?';
        console.log('  sid: issuerAndSerial serialHex=' + sh);
        if (expectSerial && serial) console.log('   expectSerial match:', sh === expectSerial);
      } else if (rest[0] && (rest[0].tag === 0xa0 || rest[0].tag === 0x80)) {  // SKI（显式/隐式）
        const ski = rest[0].tag === 0xa0 ? children(rest[0].value).find((n) => n.tag === 0x04) : rest[0];
        console.log('  sid: subjectKeyIdentifier hex=' + (ski ? ski.value.toString('hex') : '?'));
      } else bail('signer sid 形态未知 ' + (rest[0] ? T(rest[0].tag) : '空'));
      for (const q of rest.slice(1).filter((c) => c.tag === 0x30)) {
        const o = children(q.value).find((c) => c.tag === 0x06);
        console.log('  alg OID:', o ? oid(o.value) : '?', 'params:', paramsHex(q));
      }
      console.log('  signedAttrs:', si.some((c) => c.tag === 0xa0) ? '有' : '无');
    }
  } else {
    const sets = kids.filter((c) => c.tag === 0x31);
    const seqs = kids.filter((c) => c.tag === 0x30);
    if (sets.length !== 1 || seqs.length < 1) bail('envelopedData 形状不符（期望 1×SET recipientInfos + SEQUENCE encryptedContentInfo）');
    console.log('—— EnvelopedData（密钥包）判读 ——');
    for (const [i, r] of children(sets[0].value).entries()) {
      const ri = children(r.value);
      console.log(' recipient[' + i + ']:', ri.map((c) => T(c.tag) + '(' + c.len + ')').join(' '));
      const vi = ri.findIndex((c) => c.tag === 0x02);
      const rest = ri.slice(vi + 1);
      if (rest[0] && rest[0].tag === 0x30) {
        const serial = children(rest[0].value).find((n) => n.tag === 0x02);
        const sh = serial ? hex0(serial.value) : '?';
        console.log('  sid serialHex=' + sh);
        if (expectSerial && serial) console.log('   expectSerial match:', sh === expectSerial);
      } else if (rest[0] && (rest[0].tag === 0xa0 || rest[0].tag === 0x80)) {
        const ski = rest[0].tag === 0xa0 ? children(rest[0].value).find((n) => n.tag === 0x04) : rest[0];
        console.log('  sid subjectKeyIdentifier hex=' + (ski ? ski.value.toString('hex') : '?'));
      } else bail('recipient sid 形态未知');
      const algSeq = rest.slice(1).find((c) => c.tag === 0x30);
      if (algSeq) { const o = children(algSeq.value).find((c) => c.tag === 0x06); console.log('  keyEncAlg OID:', o ? oid(o.value) : '?', 'params:', paramsHex(algSeq)); }
      const ek = rest.slice(1).find((c) => c.tag === 0x04);
      if (ek) console.log('  encryptedKey ' + ek.len + ' bytes');
    }
    const eccKids = children(seqs[seqs.length - 1].value);
    const ctype = eccKids.find((c) => c.tag === 0x06);
    const calg = eccKids.find((c) => c.tag === 0x30);
    console.log('encContentType:', ctype ? oid(ctype.value) : '?');
    if (calg) { const o = children(calg.value).find((c) => c.tag === 0x06); console.log('contentEncAlg OID:', o ? oid(o.value) : '?', 'params:', paramsHex(calg)); }
    const enc = eccKids.find((c) => c.tag === 0x80);
    console.log('encryptedContent:', enc ? enc.len + ' bytes' : '(缺席/流式)');
  }
} catch (e) {
  bail('解析失败——' + e.message);
}
```


## 附录 E：与原件 sccmPlugin.js 的对照（一致性证据，消耗网关预算 2 次）

受控通道与厂商原件的行为等价性：另开一页加载 `<script src="<sccm-JAY>/sccmPlugin.js"></script>`（demo 原件），执行与 S1/S4 相同的枚举+签名，比对与送验：

| # | 操作 | 预期 | 预算 |
|---|------|------|------|
| E-1 | 原件 `SOFE_SignPKCS7Message` 签 V1（未登录时由 demo 插件自动弹 PIN 框——**勿在控制台输 PIN**；InData 用 `P0.b64()`）（**InData 用 `P0.b64()` 干净编码**）→ 送验（正确 toSign） | 通过——证明受控通道的命令/参数序列/编码与原件等价 | 1 |
| E-2 | 原件签 V5（**用原件自带 `base64Encode`**）→ 以 V5 原文（真实 CRLF）送验 | **编码事实以 S5 离线解析为准**（第 2 步已解析该 P7 内嵌字节：不含 `\r` 即证实 demo 编码吞字节——离线定案）。送验结果仅作 World A/B 佐证：拒绝→与 S5 事实一致；**通过→不能归因于中间件处理换行**（可能是 World B 网关忽略 toSign），只记录不推断 | 1 |

另做零预算比对：两通道枚举串逐字节一致；`P0.b64()` 与原件 `base64Encode()` 对 V1/V4 输出相同、对 V5/V6 输出**不同**（CRLF/4 字节差异，本地断言即可）。

## 附录 F：向厂商索取清单（随阶段0结论一并发出）

1. 测试/生产凭据（若 JSP demo 凭据无效或 G0 负对照显示测试网关不强制鉴权）：ASCII 优先（G1-R3 依据）；
2. opType 合法值表（若 G5 显示枚举校验）；
3. verifyPkcs7 对 toSign 的官方语义说明（G3 判决的书面版）与网关鉴权强制范围（G0 负对照结果）；
4. certValidate 的状态枚举与过期/吊销测试证书样本；
5. 生产 HTTPS 地址、SLA/可用性承诺、计量与配额预警（P0-2 预防）；
6. PUK/解锁流程（测试盾锁死恢复路径）；
7. 双证（签名/加密）的发行与配对规则、加密私钥续期是否随盾迁移（主方案 §5「换证」依赖）；
8. CertData 身份字段（orgNumberOrPersonNumber 等）的官方语义与来源（E1 双源结论的书面版）。

---

## 收尾声明（v3）

当前状态：**v3.2（含后台复审补丁）——T 组工具自证与 G1 离线部分已本机执行通过（§8），可进入实盾采集与有预算网关联调**（二轮复核四类问题已全部修入 v3 并经执行验证）。

阶段 0 的产出边界：**协议实现基线固定、算法范围固定、适配层实现依据固定、能力与阻断项矩阵**。不宣称登录、绑定、投标、开标可用；不替代主方案阶段 1-3 的实施与验收。

能力矩阵判定口径：每项能力的放行标准 = 「**所需检查覆盖已证明**」（不是「状态接口存在」）——身份、双证配对、签名者指纹或可信状态任一证据不足 → 对应能力**继续阻断**，记入阻断项清单。

所有结论以 evidence 文件与结论回填表为准；INCONCLUSIVE 与 NOT_RUN 是合法结论，不得粉饰为通过。

