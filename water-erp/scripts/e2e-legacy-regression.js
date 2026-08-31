#!/usr/bin/env node
/**
 * Task 20 Step 3 — 旧轨回归冒烟（API 层脚本）
 *
 * 验证：双信封新轨（feat/dual-envelope 分支）合入后，旧轨（KMS 信封 + 主持人代解密）
 * 开标演示不受影响——组建会话 → 一键解密 → 唱标 → 供应商确认 → 完成开标全链路。
 *
 * 前置：先恢复 pre-open 演示快照（脚本不做恢复，由编排方执行）：
 *   node scripts/demo-snapshot.js restore scripts/snapshots/BID-DEMO-20260817150148-pre-open.json
 *
 * 运行：node scripts/e2e-legacy-regression.js
 * 目标 API：E2E_API 环境变量（默认 http://localhost:4002——worktree 分支 API）
 */
const API = process.env.E2E_API || 'http://localhost:4002'
const PROJECT_NAME = '竞价采购公告 — 引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（解密演示）'
const SUPPLIERS = ['成都华建地质工程科技有限公司', '四川省第四地质大队', '四川省第十二地质大队']

const results = []
function record(step, pass, detail) {
  results.push({ step, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.portal) headers['X-Portal'] = opts.portal
  if (opts.session) headers['Cookie'] = opts.session
  let body
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
  const res = await fetch(`${API}${path}`, { method, headers, body })
  const text = await res.text()
  let data = text
  try { data = JSON.parse(text) } catch { /* ignore */ }
  return { status: res.status, data }
}

async function login(username, password, portal, cookieName = `token_${portal}`) {
  const headers = { 'X-Portal': portal, 'Content-Type': 'application/json' }
  const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password }) })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`login ${portal}/${username} → ${res.status} ${text.slice(0, 200)}`)
  const pair = (res.headers.get('set-cookie') || '').split(';')[0]
  if (!pair.startsWith(`${cookieName}=`)) throw new Error(`login 未写回 ${cookieName}: ${pair.slice(0, 80)}`)
  return pair
}

async function main() {
  console.log(`旧轨回归冒烟 — API=${API}`)
  const t0 = Date.now()

  // 主持人登录（经专家门户分流写 token_bid，与真实 :3007 认证链一致）
  const bidHost = await login('陈源远', '陈源远@2026', 'expert', 'token_bid')

  // 定位演示项目（快照恢复后应为 OPENING、无会话——「待组建开标会话」态）
  const list = await call('GET', '/api/bid/projects', { portal: 'bid', session: bidHost })
  const project = (list.data || []).find((p) => p.name === PROJECT_NAME)
  if (!project) throw new Error(`演示项目未找到：「${PROJECT_NAME}」——先恢复 pre-open 快照`)
  const projectId = project.id
  console.log(`  项目 ${project.projectCode} stage=${project.stage}`)
  record('快照恢复后项目处于 OPENING（待组建会话）', project.stage === 'OPENING', `stage=${project.stage}`)

  // 组建开标会话（同阶段调用，幂等 upsert）
  const open = await call('POST', `/api/bid/projects/${projectId}/open`, {
    portal: 'bid', session: bidHost,
    json: {
      host: '陈源远',
      decryptWindowStart: new Date(Date.now() - 1000).toISOString(),
      decryptWindowEnd: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  })
  record('组建开标会话（旧轨）', open.status < 300, `HTTP ${open.status}`)

  // 一键解密（旧轨主持人代解密：KMS 信封 + sealedPath 密文）
  const decAll = await call('POST', `/api/bid/projects/${projectId}/decrypt-all`, { portal: 'bid', session: bidHost })
  record('一键解密（旧轨代解密）', decAll.status < 300, `HTTP ${decAll.status} ${JSON.stringify(decAll.data || {}).slice(0, 200)}`)

  const suppliers = await call('GET', `/api/bid/projects/${projectId}/suppliers`, { portal: 'bid', session: bidHost })
  const rows = suppliers.data || []
  const allSuccess = SUPPLIERS.every((n) => rows.find((s) => s.supplierName === n)?.decryptStatus === 'SUCCESS')
  record('3 家全部解密成功（decryptStatus=SUCCESS）', allSuccess, rows.map((s) => `${s.supplierName}=${s.decryptStatus}`).join(' / '))

  // 唱标录入（旧轨：解密仅做密文校验，唱标信息由主持人据解密内容补录——
  // opening-draft 取拆封后密封报价 → POST opening-records 生成记录）
  for (const name of SUPPLIERS) {
    const bs = rows.find((s) => s.supplierName === name)
    const draft = await call('GET', `/api/bid/projects/${projectId}/suppliers/${bs.id}/opening-draft`, { portal: 'bid', session: bidHost })
    const d = draft.data || {}
    const rec = await call('POST', `/api/bid/projects/${projectId}/opening-records`, {
      portal: 'bid', session: bidHost,
      json: {
        bidSupplierId: bs.id,
        amount: d.amount,
        period: d.period || '按招标文件要求',
        qualityTarget: d.qualityTarget || '满足招标文件要求',
        bondStatus: d.bondStatus || '不适用',
      },
    })
    record(`唱标录入（${name}，拆封报价 ${d.amount}）`, rec.status < 300, `HTTP ${rec.status} ${JSON.stringify(rec.data || {}).slice(0, 120)}`)
  }

  // 唱标记录已生成
  const recs = await call('GET', `/api/bid/projects/${projectId}/opening-records`, { portal: 'bid', session: bidHost })
  const recRows = recs.data || []
  const recOk = SUPPLIERS.every((n) => {
    const r = recRows.find((x) => x.supplierName === n)
    return r && typeof r.amount === 'string' && r.amount.length > 0
  })
  record('唱标记录已生成（3 家 amount 非空）', recOk, recRows.map((r) => `${r.supplierName}:amount=${r.amount}`).join(' / '))

  // 供应商逐一确认（A-114 2026-08-31 契约：确认需电子签名——旧轨脚本供应商无盾，
  // 现场生成 sm-crypto 密钥对并走正式 bindCert 端点绑定，再对服务端重建 canonical 签名确认）
  const sm2 = require('../apps/api/node_modules/sm-crypto').sm2
  for (const name of SUPPLIERS) {
    const sess = await login(name, 'supplier@2026', 'supplier')
    const { publicKey, privateKey } = sm2.generateKeyPairHex()
    const certSn = `LEGACY-SMOKE-${Date.now().toString(36).toUpperCase()}-${encodeURIComponent(name).slice(0, 6)}`
    const bind = await call('POST', '/api/supplier-portal/profile/cert', { portal: 'supplier', session: sess, json: { certSn, certDn: `CN=${name}`, publicKey, alg: 'SM2' } })
    record(`绑证书（${name}）`, bind.status < 300, `HTTP ${bind.status}`)
    const pay = await call('GET', `/api/supplier-portal/bid-submissions/${projectId}/opening-confirm-payload`, { portal: 'supplier', session: sess })
    const signature = sm2.doSignature(pay.data.canonical, privateKey, { hash: true })
    const conf = await call('POST', `/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`, { portal: 'supplier', session: sess, json: { signature } })
    record(`供应商确认（${name}，电子签名）`, conf.status < 300 && conf.data?.success === true, `HTTP ${conf.status} ${JSON.stringify(conf.data || {})}`)
  }

  // 完成开标·资料移交
  const done = await call('POST', `/api/bid/projects/${projectId}/complete-opening`, { portal: 'bid', session: bidHost })
  record('完成开标·资料移交', done.status < 300, `HTTP ${done.status} ${JSON.stringify(done.data || {}).slice(0, 160)}`)

  // 终局复核：唱标记录 confirmStatus 供应商已确认
  const recs2 = await call('GET', `/api/bid/projects/${projectId}/opening-records`, { portal: 'bid', session: bidHost })
  const confirmed = (recs2.data || []).filter((r) => (r.confirmStatus || '').includes('已确认'))
  record('唱标记录 confirmStatus=供应商已确认', confirmed.length >= 3, `${confirmed.length}/3`)

  const failed = results.filter((r) => !r.pass)
  console.log(`\n==== 旧轨回归冒烟结果：${results.length - failed.length}/${results.length} PASS（${Math.round((Date.now() - t0) / 1000)}s）====`)
  console.log(`projectId=${projectId}`)
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('\nLEGACY REGRESSION ABORTED ❌')
  console.error(e)
  process.exit(1)
})
