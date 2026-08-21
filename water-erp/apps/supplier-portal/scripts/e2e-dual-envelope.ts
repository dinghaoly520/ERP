/* =================================================================
   Task 20 端到端冒烟 — 双信封 v2 新轨全链路（API 层脚本冒烟）

   与浏览器同源：加密/信封/签名全部复用前端生产函数
   dual-envelope-core.ts（BidSubmit.vue / OpeningHall.vue 消费），
   U盾操作用 @water-erp/ukey 的 MockUKeyAdapter（内存介质）。

   覆盖（task-20-brief Step 2）：
   2.1 新供应商注册 ×4 → 审核 → 绑 mock 证书 → 建项目（公告直建）→ 加密投递
   2.2 组建开标会话（开窗）→ 解外层（甲/丙/丁）→ 供应商解内层（含密封核验）→
       唱标比对（amount=密封报价）→ 供应商确认 ×3
   2.3 启动评标（有效投标 3 家）→ 归档（scope=opening）→ 归档清单含「解密后投标文件」
   2.4 乙：解外层未跑 + 窗口关 → UNKNOWN → 主持人裁决 → 完成开标放行

   运行：cd apps/supplier-portal && ../api/node_modules/.bin/tsx scripts/e2e-dual-envelope.ts
   目标 API：E2E_API 环境变量（默认 http://localhost:4002——worktree 分支 API）
   ================================================================= */

import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MockUKeyAdapter,
  type StorageLike,
  canonicalJson,
  computeFieldsCommit,
  sha256Hex,
  sm4Decrypt,
  unwrapDekJson,
} from '@water-erp/ukey'
import {
  sealFileForRole,
  buildEnvelope,
  utf8ToHex,
  hexToUtf8,
  bytesToHex,
} from '../src/utils/dual-envelope-core'

// ── 环境：加载 apps/api/.env（Prisma 专家注入需要 DATABASE_URL）──
const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '..', 'api', '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
}
const apiRequire = createRequire(path.join(here, '..', '..', 'api', 'package.json'))
const { PrismaClient } = apiRequire('@prisma/client')
const prisma = new PrismaClient()

const API = process.env.E2E_API ?? 'http://localhost:4002'
const RUN_ID = Date.now().toString(36).slice(-8)
const now = () => new Date()
const iso = (d: Date) => d.toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const results: Array<{ step: string; pass: boolean; detail: string }> = []
function record(step: string, pass: boolean, detail: string) {
  results.push({ step, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}

// ── HTTP ──
// 会话 = "cookie名=值" 字符串；各供应商各自持有（同名 cookie 不互相覆盖）
async function call(
  method: string,
  path: string,
  opts: { portal?: string; session?: string; json?: any; form?: FormData; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.portal) headers['X-Portal'] = opts.portal
  if (opts.session) headers['Cookie'] = opts.session
  let body: any
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) body = opts.form
  const res = await fetch(`${API}${path}`, { method, headers, body })
  const text = await res.text()
  let data: any = text
  try { data = JSON.parse(text) } catch { /* 非 JSON（下载） */ }
  return { status: res.status, data }
}
async function callBytes(path: string, session: string): Promise<Uint8Array> {
  const headers: Record<string, string> = {
    'X-Portal': 'supplier',
    Referer: 'http://localhost:3004/',
    Cookie: session,
  }
  const res = await fetch(`${API}${path}`, { headers })
  const buf = new Uint8Array(await res.arrayBuffer())
  if (res.status !== 200) throw new Error(`download ${path} → HTTP ${res.status}: ${Buffer.from(buf).toString('utf8').slice(0, 200)}`)
  return buf
}
/** 登录并返回会话串（bid 主持人经 expert 门户登录分流写 token_bid） */
async function login(username: string, password: string, portal: string, cookieName = `token_${portal}`): Promise<string> {
  const headers: Record<string, string> = { 'X-Portal': portal, 'Content-Type': 'application/json' }
  const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password }) })
  const text = await res.text()
  assert.equal(res.status, 200, `login ${portal}/${username} → ${res.status} ${text.slice(0, 200)}`)
  const sc = res.headers.get('set-cookie') ?? ''
  const pair = sc.split(';')[0]
  assert.ok(pair.startsWith(`${cookieName}=`), `login 未写回 ${cookieName}（set-cookie=${sc.slice(0, 80)}）`)
  return pair
}
function memStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
  }
}

interface Party {
  name: string
  username: string
  password: string
  fields: { price: string; deliveryPeriod: string; qualityCommitment: string }
}
const A: Party = {
  name: `双信封冒烟甲岩土工程有限公司${RUN_ID}`,
  username: `dualA${RUN_ID}`,
  password: 'Smoke@2026',
  fields: { price: '1268.5', deliveryPeriod: '120日历天', qualityCommitment: '一次验收合格' },
}
const B: Party = {
  name: `双信封冒烟乙岩土工程有限公司${RUN_ID}`,
  username: `dualB${RUN_ID}`,
  password: 'Smoke@2026',
  fields: { price: '1399', deliveryPeriod: '110日历天', qualityCommitment: '优良' },
}
const C: Party = {
  name: `双信封冒烟丙岩土工程有限公司${RUN_ID}`,
  username: `dualC${RUN_ID}`,
  password: 'Smoke@2026',
  fields: { price: '1305', deliveryPeriod: '115日历天', qualityCommitment: '合格' },
}
const D: Party = {
  name: `双信封冒烟丁岩土工程有限公司${RUN_ID}`,
  username: `dualD${RUN_ID}`,
  password: 'Smoke@2026',
  fields: { price: '1420', deliveryPeriod: '100日历天', qualityCommitment: '合格' },
}
const title = `双信封端到端冒烟项目${RUN_ID}`

async function main() {
  console.log(`双信封 e2e 冒烟 — API=${API} runId=${RUN_ID}`)
  const t0 = Date.now()

  // ═══════════ 2.1 注册 → 审核 → 绑证书 → 建项目 → 加密投递 ═══════════
  console.log('\n[2.1] 注册 → 审核 → 绑证书 → 建项目 → 加密投递')

  const parties = [A, B, C, D]
  const regBodies: Record<string, any> = {}
  const supplierIds: Record<string, string> = {}
  let seq = 0
  for (const who of parties) {
    const credit = String(90 + (++seq % 9)).padStart(1, '9') + (Date.now() + seq).toString().padStart(16, '0').slice(-16)
    regBodies[who.username] = {
      name: who.name,
      creditCode: credit,
      enterpriseType: '有限责任公司',
      legalPerson: '冒烟法人',
      registeredAddress: '成都市武侯区测试大道1号',
      businessScope: '岩土工程勘察与施工',
      username: who.username,
      displayName: '冒烟联系人',
      password: who.password,
      contacts: [{ name: '冒烟联系人', phone: '139' + String(Date.now()).slice(-8), isPrimary: true }],
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: 'https://example.com/license.pdf' }],
      tags: ['岩土工程', '勘察设计'],
    }
  }
  const staffWeb = await login('Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'web')
  for (const who of parties) {
    const reg = await call('POST', '/api/supplier/register', { json: regBodies[who.username] })
    const ok = reg.status === 201 || reg.status === 200
    supplierIds[who.username] = reg.data?.supplier?.id as string
    record(`注册+审核（${who.name}）`, ok, `HTTP ${reg.status}`)
    if (!ok) throw new Error(`register ${who.name} failed: ${JSON.stringify(reg.data)}`)
    const ap = await call('POST', `/api/supplier/${supplierIds[who.username]}/approve`, { portal: 'web', session: staffWeb })
    assert.ok(ap.status < 300, `approve ${who.name} → ${ap.status} ${JSON.stringify(ap.data)}`)
  }

  const sessions: Record<string, string> = {}
  const ukeys: Record<string, any> = {}
  const certs: Record<string, any> = {}
  for (const who of parties) {
    sessions[who.username] = await login(who.username, who.password, 'supplier')
    ukeys[who.username] = await MockUKeyAdapter.open({ storage: memStorage(), password: '123456' })
    certs[who.username] = await ukeys[who.username].createCertificate(who.name)
    const bind = await call('POST', '/api/supplier-portal/profile/cert', {
      portal: 'supplier', session: sessions[who.username],
      json: { certSn: certs[who.username].certSn, certDn: certs[who.username].certDn, publicKey: certs[who.username].publicKey, alg: 'SM2' },
    })
    record(`绑证书（${who.name}）`, bind.status < 300, `HTTP ${bind.status} certSn=${certs[who.username].certSn.slice(0, 8)}…`)
  }

  const adminCert = await call('GET', '/api/supplier-portal/admin-cert', { portal: 'supplier', session: sessions[A.username] })
  assert.ok(adminCert.data?.adminCertId && adminCert.data?.publicKey, `admin-cert 响应缺字段: ${JSON.stringify(adminCert.data)}`)
  console.log(`  管理方加密证书 adminCertId=${adminCert.data.adminCertId} certDn=${adminCert.data.certDn}`)

  // 公告直建项目（N16 A 方案：BID_NOTICE 首次发布 → 自动建 BidProject + 最小 PMI）
  const ann = await call('POST', '/api/announcements', {
    portal: 'web',
    session: staffWeb,
    json: {
      title,
      content: '<p>双信封端到端冒烟——技术/商务/投标函按双层数字信封加密投递。</p>',
      type: 'BID_NOTICE',
      status: 'PUBLISHED',
      metadata: {
        method: '公开招标',
        budget: 3000000,
        deadline: iso(new Date(t0 + 8 * 60 * 1000)), // 8 分钟后截标（提交后回拨为已过）
        openTime: iso(new Date(t0 + 5 * 60 * 1000)),
        scope: '全部内容',
        qualification: '具备岩土工程勘察资质',
        contact: '采购中心 张工',
      },
    },
  })
  record('发布招标公告（BID_NOTICE 直建项目）', ann.status < 300, `HTTP ${ann.status} relatedProjectCode=${ann.data?.relatedProjectCode ?? '?'}`)
  const relatedCode = ann.data?.relatedProjectCode as string
  assert.ok(relatedCode, '公告未回写 relatedProjectCode')

  const list = await call('GET', '/api/bid/projects', { portal: 'web', session: staffWeb })
  const project = (list.data ?? []).find((p: any) => p.name === title || p.projectCode === relatedCode)
  assert.ok(project, `项目列表未找到「${title}」`)
  const projectId = project.id as string
  console.log(`  项目 projectId=${projectId} stage=${project.stage}`)
  record('项目由公告自动创建', true, `stage=${project.stage}（期望 DOWNLOAD）`)

  // 指派主持人（:3005 开标确认面板动作）+ 主持人登录（经专家门户分流写 token_bid）
  const bidHost = await login('陈源远', '陈源远@2026', 'expert', 'token_bid')
  const me = await call('GET', '/api/auth/me', { portal: 'bid', session: bidHost })
  const hostUserId = me.data?.id as string
  const assign = await call('PATCH', `/api/bid/projects/${projectId}/assigned-host`, { portal: 'web', session: staffWeb, json: { userId: hostUserId } })
  record('指派主持人（陈源远）', assign.status < 300, `HTTP ${assign.status} hostUserId=${hostUserId}`)

  const openSub = await call('POST', `/api/bid/projects/${projectId}/open-submission`, { portal: 'bid', session: bidHost })
  record('开放投递 (DOWNLOAD→SUBMIT)', openSub.status < 300, `HTTP ${openSub.status}`)

  // 加密投递（浏览器同源函数：sealFileForRole + buildEnvelope + upload）
  const envelopes: Record<string, any> = {}
  async function submitDual(
    who: Party,
    roles: Array<{ role: 'technical' | 'business' | 'coverLetter'; content: string; name: string }>,
  ) {
    const sess = sessions[who.username]
    const ukey = ukeys[who.username]
    const cert = certs[who.username]
    const entries: Record<string, any> = {}
    const assetIds: Record<string, string> = {}
    for (const r of roles) {
      const raw = new TextEncoder().encode(`${who.name} ${r.content} —— 双信封冒烟 ${RUN_ID}`)
      const file = new File([raw as BlobPart], r.name)
      const sealed = await sealFileForRole(file, r.role, cert.publicKey, adminCert.data.publicKey)
      const fd = new FormData()
      fd.append('file', sealed.file)
      const up = await call('POST', `/api/upload?category=bid_document&clientEncrypted=true&plaintextSha256=${sealed.plainSha256}`, { portal: 'supplier', session: sess, form: fd })
      assert.ok(up.status < 300, `upload ${r.role} → HTTP ${up.status} ${JSON.stringify(up.data)}`)
      assert.equal(up.data?.sha256, sealed.plainSha256, `upload ${r.role} sha256 未落明文哈希`)
      entries[r.role] = sealed.entry
      assetIds[r.role] = up.data.id
      console.log(`  上传（${who.name} ${r.role}）：assetId=${up.data.id} 明文sha256=${sealed.plainSha256.slice(0, 12)}…`)
    }
    const { envelope, signature } = await buildEnvelope({
      entries, fields: who.fields, ukey, certSn: cert.certSn, certPublicKey: cert.publicKey, adminCertId: adminCert.data.adminCertId,
    })
    const sub = await call('POST', `/api/supplier-portal/bid-submissions/${projectId}/submit`, {
      portal: 'supplier', session: sess,
      json: {
        technicalFileAssetId: assetIds.technical,
        businessFileAssetId: assetIds.business,
        coverLetterAssetId: assetIds.coverLetter,
        envelope, signature,
      },
    })
    record(`加密投递（${who.name}，dual-v2）`, sub.status < 300, `HTTP ${sub.status} ${JSON.stringify(sub.data ?? {}).slice(0, 120)}`)
    envelopes[who.username] = envelope
  }

  await submitDual(A, [
    { role: 'technical', content: '技术标：实施方案与质量控制', name: '技术标.pdf' },
    { role: 'business', content: '商务标：报价明细与业绩', name: '商务标.pdf' },
    { role: 'coverLetter', content: '投标函：我方愿以密封报价投标', name: '投标函.pdf' },
  ])
  await submitDual(B, [{ role: 'technical', content: '技术标：钻孔施工方案', name: '技术标.pdf' }])
  await submitDual(C, [{ role: 'technical', content: '技术标：ZK10 钻孔施工组织设计', name: '技术标.pdf' }])
  await submitDual(D, [{ role: 'technical', content: '技术标：ZK12 钻孔施工组织设计', name: '技术标.pdf' }])

  // 回拨截标时间到已过（提交闸门要求未来，开标闸门要求已过——演示时间压缩）
  const patch = await call('PATCH', `/api/bid/projects/${projectId}`, { portal: 'web', session: staffWeb, json: { deadline: iso(new Date(Date.now() - 60 * 1000)) } })
  record('回拨截标时间（演示时间压缩）', patch.status < 300, `HTTP ${patch.status}`)

  // 评分标准编制（既有 :3005 评标前准备流程，须在开标前完成——开标后标准锁定）：
  // 应用标准模板（幂等）→ 发布
  const tpl = await call('POST', `/api/bid/projects/${projectId}/score-items/template`, { portal: 'web', session: staffWeb })
  record('应用评分标准模板（幂等，SUBMIT 阶段）', tpl.status < 300, `HTTP ${tpl.status} ${JSON.stringify(tpl.data ?? {}).slice(0, 120)}`)
  // 模板不携带得分点——按既有 :3005 编制流程补录（打分类每项 1 个得分点，满分=项满分；AI 提取在冒烟中不启用）
  const scoreItems = await call('GET', `/api/bid/projects/${projectId}/score-items`, { portal: 'web', session: staffWeb })
  const scoringItems = (Array.isArray(scoreItems.data) ? scoreItems.data : []).filter((i: any) => Number(i.maxScore) > 0)
  for (const item of scoringItems) {
    const pts = await call('POST', `/api/bid/projects/${projectId}/score-items/${item.id}/points/batch`, {
      portal: 'web', session: staffWeb,
      json: { points: [{ name: '冒烟得分点', fullScore: Number(item.maxScore) }] },
    })
    assert.ok(pts.status < 300, `batch points ${item.name} → ${pts.status} ${JSON.stringify(pts.data)}`)
  }
  console.log(`  补录得分点：${scoringItems.map((i: any) => `${i.name}=${i.maxScore}分`).join('、')}`)
  const pubSc = await call('POST', `/api/bid/projects/${projectId}/score-items/publish`, { portal: 'web', session: staffWeb })
  record('发布评分标准（开标前）', pubSc.status < 300, `HTTP ${pubSc.status} ${JSON.stringify(pubSc.data ?? {}).slice(0, 120)}`)

  // ═══════════ 2.2 组建会话 → 解外层 → 解内层 → 唱标 → 确认 ═══════════
  console.log('\n[2.2] 组建会话 → 解外层 → 供应商解内层（密封核验）→ 唱标 → 确认')
  const windowEnd = new Date(Date.now() + 120 * 1000)
  const open = await call('POST', `/api/bid/projects/${projectId}/open`, {
    portal: 'bid',
    session: bidHost,
    json: {
      host: '陈源远',
      supervisor: '冒烟监督人',
      decryptWindowStart: iso(new Date(Date.now() - 1000)),
      decryptWindowEnd: iso(windowEnd),
      force: true, // E4 强制开标：冒烟项目无专家抽取（checklist 阻断项已在监督日志留痕）
    },
  })
  record('组建开标会话（阶段→OPENING）', open.status < 300, `HTTP ${open.status} ${JSON.stringify(open.data ?? {}).slice(0, 140)}`)

  const suppliers = await call('GET', `/api/bid/projects/${projectId}/suppliers`, { portal: 'bid', session: bidHost })
  const bsBy: Record<string, any> = {}
  for (const who of parties) {
    bsBy[who.username] = suppliers.data.find((s: any) => s.supplierName === who.name)
    assert.ok(bsBy[who.username], `BidSupplier 行缺失: ${who.name}`)
  }

  /** 供应商解密流程：解外层（主持端单家）→ 取包 → 密封核验 → 解内层 → 揭示字段 → 解密上传 → 唱标核对 → 确认 */
  async function supplierDecryptFlow(who: Party, bsRow: any, expectRoles: string[]) {
    const sess = sessions[who.username]
    const ukey = ukeys[who.username]
    const cert = certs[who.username]
    const env = envelopes[who.username]

    const outer = await call('POST', `/api/bid/projects/${projectId}/opening/decrypt-outer`, { portal: 'bid', session: bidHost, json: { supplierId: bsRow.id } })
    record(`主持端解外层（${who.name}）`, outer.status < 300 && outer.data?.success === true, `HTTP ${outer.status} roles=${JSON.stringify(outer.data?.roles ?? [])}`)

    const pkg = await call('GET', `/api/supplier-portal/bid-submissions/${projectId}/opening-package`, { portal: 'supplier', session: sess })
    assert.ok(pkg.status < 300, `opening-package → HTTP ${pkg.status} ${JSON.stringify(pkg.data)}`)
    const pkgFiles: Array<{ role: string; assetId: string; downloadUrl: string; ciphertextSha256: string }> = pkg.data.files
    const sealedFields = pkg.data.sealedFields
    assert.equal(pkgFiles.length, expectRoles.length, `${who.name} 期望 ${expectRoles.length} 个 C_inner 角色，实得 ${pkgFiles.length}`)

    const revealed: Record<string, Uint8Array> = {}
    for (const f of pkgFiles) {
      const buf = await callBytes(f.downloadUrl, sess)
      const gotHash = await sha256Hex(buf)
      const sealOk = gotHash === f.ciphertextSha256
      record(`密封核验（${who.name} C_inner ${f.role}）`, sealOk, `本地=${gotHash.slice(0, 10)}… vs 存证=${f.ciphertextSha256.slice(0, 10)}…`)
      const wrapSHex = await ukey.decrypt(cert.certSn, env.files[f.role]!.kself)
      assert.ok(wrapSHex, `kself 解密失败（${who.name} ${f.role}）`)
      const dekS = unwrapDekJson(hexToUtf8(wrapSHex))
      const plainHex = sm4Decrypt(dekS.keyHex, dekS.ivHex, bytesToHex(buf))
      const plainBytes = new Uint8Array(plainHex.length / 2)
      for (let i = 0; i + 1 < plainHex.length; i += 2) plainBytes[i / 2] = parseInt(plainHex.slice(i, i + 2), 16)
      const plainHash = await sha256Hex(plainBytes)
      const anchor = env.files[f.role]!.sha256
      record(`解内层还原明文（${who.name} ${f.role}）`, plainHash === anchor, `sha256=${plainHash.slice(0, 10)}… vs 锚点=${anchor.slice(0, 10)}…`)
      revealed[f.role] = plainBytes
    }

    // 揭示唱标字段（sealedFields：U盾解 DEK_F → {fields, nonce}，双闸校验）
    const wrapFHex = await ukey.decrypt(cert.certSn, sealedFields.kself)
    const dekF = unwrapDekJson(hexToUtf8(wrapFHex))
    const payload = JSON.parse(hexToUtf8(sm4Decrypt(dekF.keyHex, dekF.ivHex, sealedFields.cipher)))
    const fields = payload.fields as typeof A.fields
    const nonce = payload.nonce as string
    const shaOk = sealedFields.fieldsSha256 === (await sha256Hex(canonicalJson(fields)))
    const commitOk = env.fieldsCommit === (await computeFieldsCommit(fields, nonce))
    record(`sealedFields 双闸（${who.name}）`, shaOk && commitOk, `fieldsSha256=${shaOk ? '✓' : '✗'} fieldsCommit=${commitOk ? '✓' : '✗'}`)

    // 解密上传（sha256/fieldsCommit 双闸由服务端重算）
    const fd = new FormData()
    const roleField: Record<string, string> = { technical: 'file_technical', business: 'file_business', coverLetter: 'file_coverLetter' }
    for (const r of Object.keys(revealed)) fd.append(roleField[r], new File([revealed[r] as BlobPart], `${r}.pdf`))
    fd.append('fieldsJson', canonicalJson(fields))
    fd.append('nonce', nonce)
    const decUp = await call('POST', `/api/supplier-portal/bid-submissions/${projectId}/decrypt-upload`, { portal: 'supplier', session: sess, form: fd })
    record(`解密上传（${who.name}，双闸）`, decUp.status < 300, `HTTP ${decUp.status}`)

    // 唱标比对：开标记录由 decrypt-upload 自动预填
    const recs = await call('GET', `/api/bid/projects/${projectId}/opening-records`, { portal: 'bid', session: bidHost })
    const rec = (recs.data ?? []).find((r: any) => r.supplierName === who.name)
    record(`唱标比对（${who.name} amount=密封报价）`, rec?.amount === fields.price, `amount=${rec?.amount} vs 密封 price=${fields.price}`)

    const conf = await call('POST', `/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`, { portal: 'supplier', session: sess })
    record(`开标确认（${who.name}）`, conf.status < 300 && conf.data?.success === true, `HTTP ${conf.status}`)
  }

  await supplierDecryptFlow(A, bsBy[A.username], ['technical', 'business', 'coverLetter'])
  console.log('  （乙不解外层——留给 2.4 UNKNOWN 路径）')
  await supplierDecryptFlow(C, bsBy[C.username], ['technical'])
  await supplierDecryptFlow(D, bsBy[D.username], ['technical'])

  // ═══════════ 2.4 窗口关 → UNKNOWN → 裁决 → 完成开标 ═══════════
  console.log('\n[2.4] 乙：解外层未跑 + 窗口关 → UNKNOWN → 裁决 → 完成开标')
  const waitMs = windowEnd.getTime() - Date.now() + 2500
  if (waitMs > 0) {
    console.log(`  等待解密窗口关闭 ${Math.round(waitMs / 1000)}s…`)
    await sleep(waitMs)
  }
  const done1 = await call('POST', `/api/bid/projects/${projectId}/complete-opening`, { portal: 'bid', session: bidHost })
  const unknownMarked = typeof done1.data?.error === 'string' && done1.data.error.includes(B.name)
  record('完成开标被未终局家阻塞（409 OPENING_NOT_DONE）', done1.status === 409, `HTTP ${done1.status} code=${done1.data?.code} error=${(done1.data?.error ?? '').slice(0, 80)}`)
  record('惰性归因落 UNKNOWN（乙在阻塞名单）', unknownMarked, unknownMarked ? '乙已标记 UNKNOWN 待裁决' : `error=${(done1.data?.error ?? '').slice(0, 100)}`)

  const bsBRow = (await call('GET', `/api/bid/projects/${projectId}/suppliers`, { portal: 'bid', session: bidHost })).data.find((s: any) => s.id === bsBy[B.username].id)
  record('乙 dangerAttribution=UNKNOWN（DB 侧）', bsBRow?.dangerAttribution === 'UNKNOWN', `dangerAttribution=${bsBRow?.dangerAttribution}`)

  const adj = await call('POST', `/api/bid/projects/${projectId}/opening/decrypt-adjudge`, {
    portal: 'bid',
    session: bidHost,
    json: { supplierId: bsBy[B.username].id, attribution: 'PLATFORM', reason: '端到端冒烟：模拟平台原因未解密，主持人裁决为平台责任' },
  })
  record('主持人裁决（UNKNOWN→PLATFORM）', adj.status < 300, `HTTP ${adj.status} ${JSON.stringify(adj.data ?? {}).slice(0, 160)}`)

  const bsBRow2 = (await call('GET', `/api/bid/projects/${projectId}/suppliers`, { portal: 'bid', session: bidHost })).data.find((s: any) => s.id === bsBy[B.username].id)
  record('乙终局态（DANGER+EXCEPTION+PLATFORM）', bsBRow2?.decryptStatus === 'DANGER' && bsBRow2?.confirmStatus === 'EXCEPTION' && bsBRow2?.dangerAttribution === 'PLATFORM', `decrypt=${bsBRow2?.decryptStatus} confirm=${bsBRow2?.confirmStatus} attribution=${bsBRow2?.dangerAttribution}`)

  const done2 = await call('POST', `/api/bid/projects/${projectId}/complete-opening`, { portal: 'bid', session: bidHost })
  record('完成开标·资料移交（裁决后放行）', done2.status < 300, `HTTP ${done2.status} ${JSON.stringify(done2.data ?? {}).slice(0, 160)}`)

  // ═══════════ 2.3 启动评标 → 归档含「解密后投标文件」 ═══════════
  console.log('\n[2.3] 启动评标 → 归档含「解密后投标文件」')
  // 冒烟项目无专家抽取流程：直接注入 5 名已确认正选专家（测试数据准备，数据面同 psql）
  const expertUsers = [
    'cf3c3f729cab20fd02db3f2', 'cb75a8d6afbff9233f4eaa4', 'c33b380f7fa268d8d2da4bd',
    'c6401d5d1c4480790d0b0a7', 'cca119a2d240fe6bc879622',
  ]
  const expertNames = ['代思敏', '刘黎波', '李叶', '仇海亮', '任国峰']
  for (let i = 0; i < 5; i++) {
    await prisma.bidExpert.create({
      data: {
        projectId, userId: expertUsers[i], expertName: expertNames[i],
        major: '造价', isLead: i === 3, invitationStatus: 'confirmed', expertRole: '正选',
      },
    })
  }
  console.log('  注入 5 名已确认正选专家（测试数据准备）')
  const evStart = await call('POST', `/api/bid/projects/${projectId}/start-evaluation`, { portal: 'bid', session: bidHost, json: {} })
  record('启动评标 (OPENING→EVALUATING)', evStart.status < 300, `HTTP ${evStart.status} ${JSON.stringify(evStart.data ?? {}).slice(0, 160)}`)

  const arch = await call('POST', `/api/bid/projects/${projectId}/archive-all`, { portal: 'bid', session: bidHost, json: { scope: 'opening' } })
  record('归档（scope=opening）', arch.status < 300, `HTTP ${arch.status} ${JSON.stringify(arch.data ?? {}).slice(0, 160)}`)

  const archives = await call('GET', `/api/bid/projects/${projectId}/archives`, { portal: 'bid', session: bidHost })
  const items = Array.isArray(archives.data) ? archives.data : archives.data?.items ?? []
  const hasDecryptedItem = items.some((i: any) => i.name === '解密后投标文件' || i.itemName === '解密后投标文件')
  record('归档清单含「解密后投标文件」', hasDecryptedItem, `清单项=${items.map((i: any) => i.name ?? i.itemName).join('、')}`)

  // 哈希链完整性（独立验证端点）
  const verify = await call('GET', `/api/bid/projects/${projectId}/archives/verify`, { portal: 'bid', session: bidHost })
  record('归档哈希链完整性验证', verify.status < 300, `HTTP ${verify.status} ${JSON.stringify(verify.data ?? {}).slice(0, 160)}`)

  // ── 汇总 ──
  const failed = results.filter((r) => !r.pass)
  console.log(`\n==== 双信封 e2e 冒烟结果：${results.length - failed.length}/${results.length} PASS（${Math.round((Date.now() - t0) / 1000)}s）====`)
  console.log(`projectId=${projectId} announcement=${ann.data?.id} suppliers=${parties.map((p) => supplierIds[p.username]).join(',')}`)
  if (failed.length) {
    console.log('失败项：')
    for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`)
  }
  await prisma.$disconnect()
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\nE2E ABORTED ❌')
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
