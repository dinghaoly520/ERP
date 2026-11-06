# embed 嵌入服务验证 curl（bge-m3 vLLM · :8003）

> 2026-11-02 实测定稿。服务由 PM2 托管（进程名 `procurement-embedding`，绑 0.0.0.0 供 zhishiku 容器共用），
> ERP API 经 `local-ai/EmbeddingService` 消费，配置在 `apps/api/.env`：

```
EMBEDDING_BASE_URL=http://localhost:8003/v1
EMBEDDING_MODEL=/home/asus/models/bge-m3
```

## 基础版（原样请求）

```bash
curl -s -X POST http://localhost:8003/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"/home/asus/models/bge-m3","input":["连通性测试"]}'
```

## 校验版（解析维度）

```bash
curl -s -m 10 -X POST http://localhost:8003/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"/home/asus/models/bge-m3","input":["连通性测试"]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('维度:', len(d['data'][0]['embedding']), '| model:', d['model'], '| 前3维:', d['data'][0]['embedding'][:3])"
```

2026-11-02 实测输出：

```
维度: 1024 | model: /home/asus/models/bge-m3 | 前3维: [-0.030771393328905106, 0.01464167144129, -0.014265066012740135]
```

## 注意事项

- **`model` 必须填全路径** `/home/asus/models/bge-m3`——vLLM 启动未带 `--served-model-name`，model id 即路径本身，填 `bge-m3` 会 404。
- **`input` 是数组**，可批量传多条文本（`"input":["文本1","文本2"]`），返回 `data` 数组按 `index` 对应。
- **bge-m3 输出固定 1024 维**——校验版输出非 1024 即异常。
- 本机代理开着时须加 `--noproxy '*'`（7897 代理会劫持请求）；2026-11-02 代理已关，实测不带该参数正常。

## API 级全链路 curl（上传文件 → 通用审查 → 轮询结果）

直连 :4001，须带 `X-Portal: web` 头 + `token_web` cookie（curl cookie jar）。端点路径读自
`apps/api/src/tender-review/tender-review.controller.ts`（`@Controller('tender-review')` + 全局前缀 `api`）。

> **副作用提示**：:3005 单设备登录——curl 登录会把**同账号**的浏览器会话踢下线；curl 请用与浏览器
> 不同的种子账号（如浏览器用 `Swhi-CGZX-05`，curl 用 `Swhi-CGZX-01`）。通用审查 = 语义检索（embed）
> + LLM 判断，会真实消耗 DeepSeek 配额并落一条审查任务。

### 0. 登录拿 cookie

```bash
curl -s -c /tmp/tr-cookies.txt -X POST http://localhost:4001/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Portal: web' \
  -d '{"username":"Swhi-CGZX-01","password":"Swhi-CGZX-01@2026"}'
```

### 1. 列知识库，取 `id`（须选有向量化语料的库）

```bash
curl -s -b /tmp/tr-cookies.txt -H 'X-Portal: web' \
  http://localhost:4001/api/knowledge | jq '.[] | {id, name}'
```

### 2. 上传待审文件（multipart，字段名 `file`；pdf/docx/doc/txt）

```bash
curl -s -b /tmp/tr-cookies.txt -X POST \
  http://localhost:4001/api/tender-review/review/upload \
  -H 'X-Portal: web' \
  -F 'file=@/path/to/采购文件.docx'
# → {documentName, objectKey, content, contentLength}
```

### 3. 发起通用审查（reviewMode=general 才走 embed；strict 是规则引擎）

`documentContent` 很长，手工拼 JSON 易错，用 jq 从上一步结果拼装（步骤 2+3 一条链）：

```bash
KB_ID=<第1步取到的知识库id>

curl -s -b /tmp/tr-cookies.txt -X POST \
  http://localhost:4001/api/tender-review/review/upload \
  -H 'X-Portal: web' -F 'file=@/path/to/采购文件.docx' \
| jq -n --arg kb "$KB_ID" --slurpfile up - \
    '{knowledgeBaseId:$kb, reviewMode:"general",
      documentName:$up[0].documentName, objectKey:$up[0].objectKey,
      documentContent:$up[0].content}' \
| curl -s -b /tmp/tr-cookies.txt -X POST \
    http://localhost:4001/api/tender-review/review/execute \
    -H 'Content-Type: application/json' -H 'X-Portal: web' -d @-
# → {taskId, status}
```

### 4. 轮询任务结果（COMPLETED 即全链路通）

```bash
curl -s -b /tmp/tr-cookies.txt -H 'X-Portal: web' \
  http://localhost:4001/api/tender-review/review/tasks/<taskId> | jq '{id, status, mode}'
```

embed 断链的表现：步骤 3/4 报错或语义项为空。此时先用本文最上方的 :8003 直连 curl 定位
是 vLLM 死了还是 API 侧没调到（看 :4001 日志有无 `:8003/v1/embeddings` 请求）。

## 2026-11-02 实跑记录（全链路已验证 ✅）

按上述 0→4 步骤实跑一遍，全部通过：

| 步骤 | 结果 |
|------|------|
| 0 登录 | `Swhi-CGZX-01`（leader）成功，`token_web` 落 cookie jar |
| 1 列知识库 | 共享库「采购知识库」`cms48o9hx00equuhx4cixdfb9`（7 文件已分块、326 规则） |
| 2 上传 | `/tmp/embed-verify-待审文件.txt`（.txt 在白名单）→ 解析正文 368 字 |
| 3 执行 | `reviewMode=general`，taskId `cmvyrsull00giuuve3hpx69ph` |
| 4 轮询 | running 70s 后 **completed**（总检查 5 / 不通过 2 / 警告 5） |

**embed 生效的直接证据**——`results.generalResults[].issues[].knowledgeBaseReferences[]`
带 pgvector 相似度分数与命中文件：

- 引用 100 条，相似度分数 **0.6302 ~ 0.7202**（此类浮点分数只能来自向量检索）
- 命中 6 个知识库文件：采购管理办法（修订）76号、主体责任履行指引（发改法规〔2025〕1358号）、
  川办规（2025）8号、川国资委〔2025〕51号等
- LLM 判断产出实质结论，如：资格条件「2021年1月1日以来无在建项目」超出「目前无在建」合理要求、
  可能不合理限制潜在投标人（附 replace 修改建议、引用《采购管理办法》第八条/招标投标法第十八条）

任务记录落在库里，:3005 `/tender-review` →「审查报告」tab 可见，可作 UI 侧交叉核验。

**踩坑备注**：jq 过滤器里中文键名必须加引号（`{"引用总数": ...}`），裸写报
`INVALID_CHARACTER`；上传的 txt 在 `-F` 里显式 `;type=text/plain`。

## 页面级全链路验证（:3005 采购文件审查）

服务层 curl 只验证 vLLM 本体；要验证 API→pgvector RAG→检索结果全链路，走页面：

1. 登录 `http://localhost:3005`（`Swhi-CGZX-05` / `Swhi-CGZX-05@2026`，或 leader `Swhi-CGZX-01`）。
2. 打开 `http://localhost:3005/tender-review`，默认「审查执行」tab：**选知识库（必选，不选后续全灰）→ 上传 DOCX/PDF → 审查模式选「通用审查」→ 执行**。
3. 必须选「**通用审查**」（语义检索 + LLM 判断，这条链才打 embedding）；「严格审查」是规则引擎，不打 embed。
4. 排查提示：语义审查结果为空时，先区分「知识库没数据/未向量化」还是「embed 断链」——换确认有文档的库再试，或看 :4001 日志有无对 `:8003/v1/embeddings` 的请求。
