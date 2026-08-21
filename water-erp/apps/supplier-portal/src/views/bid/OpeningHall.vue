<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import { openingHallApi } from '@/api/openingHall'
import { getOpeningPackage, decryptUpload } from '@/api/openingPackage'
import { MockUKeyAdapter, type StorageLike, sha256Hex, canonicalJson, sm4Decrypt, unwrapDekJson } from '@water-erp/ukey'
import { hexToBytes, hexToUtf8, bytesToHex } from '@/utils/dual-envelope-core'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import { useAuthStore } from '@/stores/auth'
import { User } from '@element-plus/icons-vue'
import ChatPanel from '@/components/bid/ChatPanel.vue'

const route = useRoute()
const authStore = useAuthStore()
const projectId = route.params.projectId as string

const project = ref<any>(null)
const record = ref<any>(null)
const records = ref<any[]>([])
const checkedInAt = ref<string | null>(null)
const onlineCount = ref(0)
const decryptStatus = ref<string>('')
const stage = computed<string>(() => project.value?.stage ?? '')
const isOpening = computed(() => stage.value === 'OPENING')
const supplierId = ref('')
const supplierName = ref('')
const loadError = ref(false)
const loadErrorMsg = ref('')
const profileError = ref(false)
const bootstrapping = ref(false)

/* ═══ 双信封 v2：解密我的投标（§5.3）═══ */
// isDualTrack：null=探测中（轮询未决），true=双层新轨（本卡片生效），false=旧轨（主持端代解密，卡片隐藏）
const isDualTrack = ref<boolean | null>(null)
const pkg = ref<any>(null)
const pkgState = ref<'loading' | 'ready' | 'waiting' | 'error'>('loading')
const pkgError = ref<{ code: string; error: string } | null>(null)
const sealKey = ref('') // 当前核验过的文件集（assetId 序列）——轮询到新文件集才重做密封核验
const sealResults = ref<Record<string, 'pending' | 'ok' | 'fail' | 'unavailable'>>({})
const sealChecking = ref(false)
const cachedInnerBytes = ref<Record<string, { assetId: string; bytes: Uint8Array }>>({}) // 密封核验下载的 C_inner 字节缓存，解密时复用免二次下载
// U盾会话（仅内存持有介质实例与所选证书；口令用后即清，不落任何持久存储/日志）
const profileSm2PublicKey = ref('')
const ukeyAdapter = ref<MockUKeyAdapter | null>(null)
const ukeyCertSn = ref('')
const ukeyPassword = ref('')
const ukeyOpening = ref(false)
const ukeyDialogVisible = ref(false)
// 解密上传
const decrypting = ref(false)
const decryptStage = ref('')
const decryptError = ref('')
const revealedFields = ref<{ price: string; deliveryPeriod: string; qualityCommitment: string } | null>(null)
let pkgTimer: ReturnType<typeof setInterval> | null = null

/** MockUKeyAdapter storage 适配（与 UkeyManage.vue/BidSubmit.vue 同键，仅口令加密 keystore 落 localStorage） */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
}

/** 本地缓存的绑定证书序列号（UkeyManage.vue 绑定成功后写入；仅公开信息） */
function boundCertSn(): string {
  try {
    const raw = localStorage.getItem('supplier_ukey_bound')
    return raw ? (JSON.parse(raw)?.certSn ?? '') : ''
  } catch { return '' }
}

const ROLE_LABELS: Record<string, string> = {
  technical: '技术标', business: '商务标', coverLetter: '投标函', bond: '保证金凭证',
}

/** opening-package 业务码 → 卡片内文案（轮询错误静默展示，不弹全局 toast） */
const PKG_ERROR_TEXT: Record<string, string> = {
  OUTER_NOT_DECRYPTED: '外层尚未解密，等待主持方解外层',
  DECRYPT_WINDOW_NOT_OPEN: '解密窗口尚未开启',
  DECRYPT_WINDOW_CLOSED: '解密窗口已关闭，请联系主持人延长窗口',
  OPENING_PAUSED: '开标已暂停，等待主持人恢复',
  OPENING_NOT_STARTED: '开标尚未启动（主持人组建会话后开始）',
  NOT_DUAL_TRACK: '本标书为传统加密投递，由主持人统一解密',
  NO_SUBMISSION: '尚未提交投标文件',
  ENVELOPE_MISSING: '信封缺失，请联系平台排查',
  PROJECT_NOT_OPENING: '项目不在开标阶段',
}
const pkgErrorText = computed(() => pkgError.value
  ? (PKG_ERROR_TEXT[pkgError.value.code] || pkgError.value.error)
  : '')

/** 投递报价显示文本：有唱标锚点时归一为元（与唱标总表「报价（元）」单位统一）；
 *  未唱标回落投递表单口径（<10000 万元、≥10000 元，见 BidSubmit.vue formatBidPrice） */
const submittedPriceText = computed(() => {
  const s = record.value?.submitted
  if (!s?.bidPrice) return '—'
  if (s.bidPriceInYuan != null) return `${s.bidPriceInYuan} 元`
  const n = Number(s.bidPrice)
  if (!Number.isFinite(n)) return '—'
  return n >= 10000 ? `${s.bidPrice} 元` : `${s.bidPrice} 万元`
})

async function refresh() {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  try {
    const [p, r, list] = await Promise.all([
      bidApi.getProject(projectId),
      supplierApi.getOpeningRecord(projectId).catch(() => null),
      // 开标前端点返回 400 OPENING_NOT_STARTED——捕获后置空列表，页面不报错
      supplierApi.getOpeningRecords(projectId).catch(() => null),
    ])
    project.value = p
    record.value = r
    records.value = list ?? []
    loadError.value = false
  } catch (e: any) {
    // 失败保留上次成功数据，仅置标志；首屏（project 为空）时由错误态 + 重试展示
    loadError.value = true
    loadErrorMsg.value = e?.response?.data?.error || e?.message || '加载开标大厅数据失败'
  }
}

async function loadProfile() {
  try {
    // 注：getProfile 的 TS 静态类型为 AxiosResponse（拦截器运行时已解包）——sm2PublicKey 读取加断言，
    // 避免新增类型错误；id/name 两行为存量错误（vue-tsc 基线），不动。
    const profile = await supplierApi.getProfile()
    supplierId.value = profile?.id ?? ''
    supplierName.value = profile?.name ?? ''
    profileSm2PublicKey.value = (profile as any)?.sm2PublicKey ?? ''
    profileError.value = !supplierId.value
  } catch {
    profileError.value = true
  }
}

async function retryProfile() {
  profileError.value = false
  await loadProfile()
  if (profileError.value) ElMessage.error('加载供应商信息失败，会话暂不可用')
}

/** 首屏加载逻辑：挂载与"重试"共用 */
async function bootstrap() {
  bootstrapping.value = true
  await Promise.all([loadProfile(), refresh(), loadPresence()])
  bootstrapping.value = false
  if (loadError.value && !project.value) ElMessage.error(loadErrorMsg.value)
}

async function loadPresence() {
  const res = await openingHallApi.presence(projectId).catch(() => null)
  if (res) onlineCount.value = res.onlineCount ?? 0
}

/* ═══ 双信封 v2：解密包轮询（10s，OPENING 阶段；silent 静默，业务码在卡片内展示）═══ */
async function pollPackage() {
  if (!isOpening.value || !record.value?.submitted) return
  try {
    const data = await getOpeningPackage(projectId)
    isDualTrack.value = true
    pkg.value = data
    pkgState.value = 'ready'
    pkgError.value = null
    // 文件集变化（assetId 序列）才重做密封核验——轮询幂等，避免重复下载大文件
    const key = (data?.files ?? []).map((f: any) => f.assetId).join(',')
    if (sealKey.value !== key) {
      sealKey.value = key
      void verifySeals()
    }
  } catch (e: any) {
    const code = e?.response?.data?.code
    const msg = e?.response?.data?.error
    if (code === 'NOT_DUAL_TRACK') {
      // 旧轨（单层信封）投递：由主持端代解密，本卡片隐藏并停止轮询
      isDualTrack.value = false
      pkgState.value = 'error'
      return
    }
    if (code === 'OUTER_NOT_DECRYPTED') {
      pkgState.value = 'waiting'
      pkg.value = null
    } else {
      pkgState.value = 'error'
    }
    pkgError.value = { code: code ?? '', error: msg ?? '获取解密包失败' }
  }
}

/** 密封核验（招标投标法第36条「当众检查投标文件密封情况」电子化对应物）：
 *  下载 C_inner 本地重算 SHA-256 与投递存证 ciphertextSha256 比对——通过则缓存字节供解密复用。
 *  下载失败（网络/CORS）降级为「无法核验」提示，不阻断解密。 */
async function verifySeals() {
  const files = pkg.value?.files
  if (!files?.length) return
  sealChecking.value = true
  for (const f of files) {
    sealResults.value[f.role] = 'pending'
    try {
      const res = await fetch(f.downloadUrl, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const digest = await sha256Hex(bytes)
      if (digest === f.ciphertextSha256) {
        sealResults.value[f.role] = 'ok'
        cachedInnerBytes.value[f.role] = { assetId: f.assetId, bytes }
      } else {
        sealResults.value[f.role] = 'fail'
      }
    } catch {
      sealResults.value[f.role] = 'unavailable'
    }
  }
  sealChecking.value = false
}

/** 轮询定时器生命周期：OPENING + 已提交 + 未确认旧轨 → 每 10s 探测；其余停止 */
function syncPkgTimer() {
  const active = isOpening.value && !!record.value?.submitted && isDualTrack.value !== false
  if (active && !pkgTimer) {
    void pollPackage()
    pkgTimer = setInterval(() => { pollPackage().catch(() => {}) }, 10000)
  } else if (!active && pkgTimer) {
    clearInterval(pkgTimer)
    pkgTimer = null
  }
}
watch([isOpening, () => !!record.value?.submitted, isDualTrack], syncPkgTimer)
onUnmounted(() => { if (pkgTimer) clearInterval(pkgTimer) })

/* ═══ U盾会话（与 BidSubmit.vue 同口径：开锁仅内存持有；口令不持久化）═══ */
async function handleUkeyOpen() {
  if (!ukeyPassword.value) { ElMessage.warning('请输入 U盾口令'); return }
  ukeyOpening.value = true
  try {
    const uk = await MockUKeyAdapter.open({ storage: ukeyStorage, password: ukeyPassword.value })
    const certs = await uk.listCertificates()
    const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.publicKey === profileSm2PublicKey.value)
    if (!cert) throw new Error('介质内未找到与平台绑定的证书，请先到「U盾管理」页绑定或导入备份介质')
    ukeyAdapter.value = uk
    ukeyCertSn.value = cert.certSn
    ukeyPassword.value = ''
    ukeyDialogVisible.value = false
    ElMessage.success(`U盾已开锁（${cert.certSn}）`)
  } catch (e: any) {
    ElMessage.error(e?.message || 'U盾开锁失败')
  } finally {
    ukeyOpening.value = false
  }
}

/** U盾解密并上传：C_inner → SM2(kself)→DEK_S → SM4 → 明文 ×N 角色 + sealedFields 揭示 F+nonce → decrypt-upload */
async function handleDecryptUpload() {
  if (!ukeyAdapter.value || !ukeyCertSn.value) { ukeyDialogVisible.value = true; return }
  const p = pkg.value
  if (!p?.files?.length) { ElMessage.warning('解密包未就绪，请等待外层解密完成'); return }
  decrypting.value = true
  decryptError.value = ''
  try {
    decryptStage.value = 'U盾解密投标文件…'
    const FIELD_BY_ROLE: Record<string, string> = {
      technical: 'file_technical', business: 'file_business',
      coverLetter: 'file_coverLetter', bond: 'file_bond',
    }
    const form = new FormData()
    for (const f of p.files) {
      const cached = cachedInnerBytes.value[f.role]
      let bytes: Uint8Array | null = cached && cached.assetId === f.assetId ? cached.bytes : null
      if (!bytes) {
        const res = await fetch(f.downloadUrl, { credentials: 'include' })
        if (!res.ok) throw new Error(`解密包下载失败（HTTP ${res.status}）`)
        bytes = new Uint8Array(await res.arrayBuffer())
      }
      const kself = p.kselfByRole?.[f.role]
      if (!kself) throw new Error(`信封缺少「${ROLE_LABELS[f.role] ?? f.role}」供应商密钥件（kself）`)
      const dekJsonHex = await ukeyAdapter.value.decrypt(ukeyCertSn.value, kself)
      const dek = unwrapDekJson(hexToUtf8(dekJsonHex))
      const plainHex = sm4Decrypt(dek.keyHex, dek.ivHex, bytesToHex(bytes))
      form.append(FIELD_BY_ROLE[f.role], new File([hexToBytes(plainHex)], `${f.role}.plain`, { type: 'application/octet-stream' }))
    }

    // 唱标字段密封件：U盾解 DEK_F → SM4 解 → {fields, nonce}；fieldsSha256 本地核验后随包上传
    decryptStage.value = '揭示唱标字段（密封核验）…'
    const sf = p.sealedFields
    if (!sf?.kself || !sf?.cipher) throw new Error('信封缺少唱标字段密封件')
    const dekFJsonHex = await ukeyAdapter.value.decrypt(ukeyCertSn.value, sf.kself)
    const dekF = unwrapDekJson(hexToUtf8(dekFJsonHex))
    const sealedJson = hexToUtf8(sm4Decrypt(dekF.keyHex, dekF.ivHex, sf.cipher))
    let payload: { fields: { price?: string; deliveryPeriod?: string; qualityCommitment?: string }; nonce: string }
    try {
      payload = JSON.parse(sealedJson)
      if (!payload?.fields || typeof payload.nonce !== 'string') throw new Error('bad shape')
    } catch {
      throw new Error('唱标字段密封件解析失败（密封件损坏）')
    }
    if (sf.fieldsSha256) {
      const digest = await sha256Hex(canonicalJson(payload.fields))
      if (digest !== sf.fieldsSha256) throw new Error('唱标字段密封核验失败（fieldsSha256 不匹配，密封件可能被调包）')
    }
    form.append('fieldsJson', canonicalJson(payload.fields))
    form.append('nonce', payload.nonce)

    decryptStage.value = '上传解密明文（完整性/承诺双闸校验）…'
    const res = await decryptUpload(projectId, form)
    if (res?.decryptStatus === 'SUCCESS') {
      revealedFields.value = {
        price: payload.fields.price ?? '',
        deliveryPeriod: payload.fields.deliveryPeriod ?? '',
        qualityCommitment: payload.fields.qualityCommitment ?? '',
      }
      decryptStatus.value = 'SUCCESS'
      ElMessage.success('解密成功，唱标信息已提交，等待主持人核对')
      refresh().catch(() => {})
    } else {
      // 双闸失败：HTTP 200 + decryptStatus=DANGER（归因 UNKNOWN/PLATFORM，§5.5 矩阵行 4）——非 4xx，须读返回值判定
      const reason = res?.decryptError || '解密失败（完整性/承诺校验未通过）'
      decryptError.value = reason
      ElMessage.error(reason)
      refresh().catch(() => {})
    }
  } catch (e: any) {
    // axios 错误（400 门控等）：拦截器已弹业务消息（decrypt-upload 非 silent）；本地解密错误需自行提示
    decryptError.value = e?.response?.data?.error || e?.message || '解密上传失败'
    if (!e?.isAxiosError) ElMessage.error(decryptError.value)
  } finally {
    decrypting.value = false
    decryptStage.value = ''
  }
}

async function checkIn() {
  try {
    const res = await openingHallApi.checkIn(projectId)
    checkedInAt.value = res.checkInAt
    ElMessage.success('签到成功')
  } catch {
    // U5：业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

async function confirmRecord() {
  try {
    await ElMessageBox.confirm('确认开标记录（唱标信息）无误？', '确认开标记录', { type: 'info' })
    await supplierApi.confirmOpening(projectId)
    ElMessage.success('已确认开标记录')
    await refresh()
  } catch (e: any) {
    // ElMessageBox：取消按钮 reject 'cancel'，ESC/X 关闭 reject 'close'——都属用户关闭，静默
    if (e === 'cancel' || e === 'close' || e?.toString?.().includes('cancel') || e?.toString?.().includes('close')) return
    // U5：其余业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

async function disputeRecord() {
  try {
    const { value } = await ElMessageBox.prompt('请输入异议原因', '提出开标异议', {
      inputType: 'textarea',
      inputValidator: (v: string) => (v?.trim() ? true : '请填写异议原因'),
    })
    await supplierApi.disputeOpening(projectId, value)
    ElMessage.success('异议已提交，请等待主持人处理')
    await refresh()
  } catch (e: any) {
    if (e === 'cancel' || e === 'close' || e?.toString?.().includes('cancel') || e?.toString?.().includes('close')) return
    // U5：其余业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

useBidWebSocket(projectId, {
  // refresh 内部已 try/catch（失败置标志、保留上次数据），.catch 仅作兜底，避免 unhandled rejection
  onStageChange: () => { refresh().catch(() => {}) },
  onDecryptStatus: d => { if (d.supplierId === supplierId.value) decryptStatus.value = d.decryptStatus },
  onHallPresence: d => { onlineCount.value = d.onlineCount },
  onOpeningDisputeResolved: d => {
    ElMessage.info(d.confirm ? `异议已处理（确认）：${d.result}` : `异议已处理（退回）：${d.result}`)
    refresh().catch(() => {})
  },
  // 唱标录入/更新 → 实时刷新开标记录（此前无此事件，唱标后供应商页不更新，只能手动刷新）
  onOpeningRecordUpdated: () => { refresh().catch(() => {}) },
})

onMounted(bootstrap)
</script>

<template>
  <div class="hall">
    <!-- 首屏加载失败（尚无项目数据）：错误态 + 重试 -->
    <el-empty v-if="loadError && !project" class="hall-error" :description="loadErrorMsg || '加载开标大厅数据失败'">
      <el-button type="primary" :loading="bootstrapping" @click="bootstrap">重试</el-button>
    </el-empty>
    <template v-else>
    <div class="left">
      <el-card shadow="never">
        <template #header>
          <div class="head">
            <span class="name">{{ project?.name || '加载中…' }}</span>
            <div class="meta">
              <!-- 在线数：图标 + 等宽数字，左对齐（开标阶段状态由签到按钮/阶段提示条/聊天禁言条表达，不再单设徽标） -->
              <span class="presence">
                <el-icon :size="14"><User /></el-icon>
                在线 <b class="num">{{ onlineCount }}</b> 家
              </span>
            </div>
          </div>
        </template>

        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="本司解密状态">{{ decryptStatus || record?.decryptResult || '—' }}</el-descriptions-item>
          <el-descriptions-item label="唱标金额">{{ record?.amount != null ? `${record.amount} 元` : '—' }}</el-descriptions-item>
          <el-descriptions-item label="投递报价">
            <span :class="{ 'mismatch': record?.submitted?.priceMismatch }">{{ submittedPriceText }}</span>
            <el-tag v-if="record?.submitted?.priceMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="工期（唱标）">{{ record?.period || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工期（投递）">
            <span :class="{ 'mismatch': record?.submitted?.periodMismatch }">{{ record?.submitted?.deliveryPeriod || '—' }}</span>
            <el-tag v-if="record?.submitted?.periodMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="质量承诺（唱标）">{{ record?.qualityTarget || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.submitted?.qualityCommitment" label="质量承诺（投递）">
            <span :class="{ 'mismatch': record.qualityTarget != null && record.qualityTarget !== record.submitted.qualityCommitment }">{{ record.submitted.qualityCommitment }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="开标记录状态">{{ record?.confirmStatus || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.handleResult" label="异议处理结果">{{ record.handleResult }}</el-descriptions-item>
        </el-descriptions>

        <div class="actions">
          <el-button v-if="isOpening && !checkedInAt" type="primary" @click="checkIn">签到</el-button>
          <el-tag v-else-if="checkedInAt" type="info">已签到 {{ new Date(checkedInAt).toLocaleTimeString('zh-CN') }}</el-tag>
          <!-- 后端/种子数据实际写入 '待供应商确认'（bid.service.ts:913），旧页兼容 '待确认'，两者都接受 -->
          <template v-if="isOpening && record && (record.confirmStatus === '待确认' || record.confirmStatus === '待供应商确认')">
            <el-button type="success" @click="confirmRecord">确认开标记录</el-button>
            <el-button type="warning" @click="disputeRecord">提出异议</el-button>
          </template>
        </div>
        <div v-if="!isOpening && stage" class="stage-hint">大厅互动仅在开标阶段开放。</div>
      </el-card>

      <!-- ═══ 双信封 v2：解密我的投标（§5.3）——OPENING 阶段轮询 opening-package（10s）═══
           旧轨（NOT_DUAL_TRACK）投递自动隐藏：由主持端代解密，本卡片不参与 -->
      <el-card v-if="isOpening && record?.submitted && isDualTrack !== false" shadow="never" class="decrypt-card">
        <template #header>
          <div class="records-head">
            <span class="records-title">解密我的投标</span>
            <span class="records-count">双层信封 · 每 10 秒自动刷新</span>
          </div>
        </template>

        <!-- 包未就绪三态：等待外层 / 窗口类错误 / 首次加载 -->
        <template v-if="pkgState !== 'ready'">
          <el-alert v-if="pkgState === 'waiting'" type="info" :closable="false" show-icon
            title="等待主持方解外层…"
            description="外层由主持人在解密窗口内启动解密（管理方私钥在服务端执行），就绪后本卡片自动显示文件清单。" />
          <el-alert v-else-if="pkgState === 'error'" type="warning" :closable="false" show-icon
            :title="pkgErrorText || '解密包暂不可用'"
            description="页面每 10 秒自动重试，无需手动刷新。" />
          <el-alert v-else type="info" :closable="false" show-icon title="正在获取解密包…" />
        </template>

        <!-- 包就绪：文件清单 + 密封核验 + U盾解密上传 -->
        <template v-else>
          <div class="pkg-hint">
            解密窗口截止 {{ new Date(pkg.windowEnd).toLocaleTimeString('zh-CN') }}<template v-if="pkg.paused">（开标已暂停，解密操作暂时禁止）</template>
          </div>

          <!-- 密封核验（招标投标法第36条「当众检查投标文件密封情况」的电子化对应物） -->
          <div class="seal-block">
            <div class="seal-title">密封核验 —— 本地重算 C_inner 密文 SHA-256，与投递存证比对</div>
            <div v-for="f in pkg.files" :key="f.role" class="seal-row">
              <span class="seal-role">{{ ROLE_LABELS[f.role] || f.role }}</span>
              <el-tag v-if="sealResults[f.role] === 'ok'" size="small" type="success" effect="plain">密封完好</el-tag>
              <el-tag v-else-if="sealResults[f.role] === 'fail'" size="small" type="danger" effect="plain">密封不符！请勿解密，联系主持人</el-tag>
              <el-tag v-else-if="sealResults[f.role] === 'unavailable'" size="small" type="warning" effect="plain">无法核验（下载失败）</el-tag>
              <el-tag v-else size="small" type="info" effect="plain">核验中…</el-tag>
            </div>
            <el-button size="small" text type="primary" :disabled="sealChecking" @click="verifySeals">重新核验密封</el-button>
          </div>

          <!-- 解密成功：揭示唱标字段（F 揭示值，与承诺一致后落 decryptedPrice；报价按投递时口径原样揭示） -->
          <el-alert v-if="revealedFields" type="success" :closable="false" show-icon title="解密成功，唱标字段已揭示并提交">
            <div class="revealed">
              <span>报价：<b>{{ revealedFields.price }}</b></span>
              <span>工期：<b>{{ revealedFields.deliveryPeriod }}</b></span>
              <span>质量承诺：<b>{{ revealedFields.qualityCommitment }}</b></span>
            </div>
            <div class="pkg-hint">等待主持人核对唱标信息，随后请在本页确认开标记录。</div>
          </el-alert>

          <!-- 解密失败原因（双闸失败 / 门控 400）：失败即归因，可联系主持人重置解密机会 -->
          <el-alert v-if="decryptError && !revealedFields" type="error" :closable="false" show-icon
            :title="decryptError"
            description="解密失败已记录归因（投标人/平台/待裁决由主持人判定）。若为平台原因，可联系主持人「重置解密机会」后重试。" />

          <!-- 未解密成功：U盾 + 解密上传 -->
          <template v-if="!revealedFields">
            <div class="ukey-row">
              <span v-if="ukeyCertSn" class="ukey-ok">U盾已开锁：{{ ukeyCertSn }}</span>
              <span v-else class="ukey-hint">需使用投递时的 U盾证书（或导入的备份介质）解密</span>
              <el-button type="primary" size="small" :loading="decrypting" :disabled="sealChecking || !!pkg.paused" @click="handleDecryptUpload">
                {{ decrypting ? (decryptStage || '解密中…') : 'U盾解密并上传' }}
              </el-button>
            </div>
          </template>
        </template>
      </el-card>

      <!-- U盾口令弹窗（开锁后自动继续解密；口令仅内存持有，用后即清） -->
      <el-dialog v-model="ukeyDialogVisible" title="U盾解密" width="440px" :close-on-click-modal="false" destroy-on-close @closed="ukeyPassword = ''">
        <p class="ukey-desc">解密内层与揭示唱标字段需使用投递时的 U盾证书。请输入 U盾口令完成介质开锁。</p>
        <el-input v-model="ukeyPassword" type="password" show-password placeholder="U盾口令" size="large" @keyup.enter="handleUkeyOpen" />
        <p class="ukey-hint">证书未绑定或介质遗失？前往 <router-link to="/profile/ukey">U盾管理</router-link> 绑定或导入备份介质。</p>
        <template #footer>
          <el-button @click="ukeyDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="ukeyOpening" @click="handleUkeyOpen">开锁</el-button>
        </template>
      </el-dialog>

      <!-- 唱标记录总表：自开标起向本项目全体投标人公开（《电子招标投标办法》第30条），
           WS opening:record:updated → refresh() 实时更新；本司行按 bidSupplierId 高亮 -->
      <el-card shadow="never" class="records-card">
        <template #header>
          <div class="records-head">
            <span class="records-title">唱标记录（全部投标人）</span>
            <span class="records-count">{{ records.length }} 条</span>
          </div>
        </template>
        <el-table :data="records" size="small" empty-text="暂无唱标记录（开标后实时展示）">
          <el-table-column label="供应商" min-width="180" class-name="col-supplier">
            <template #default="{ row }">
              <span>{{ row.supplierName }}</span>
              <el-tag v-if="row.bidSupplierId === record?.bidSupplierId" size="small" type="info" class="self-tag">本司</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="报价（元）" min-width="110" />
          <el-table-column prop="period" label="工期" min-width="100" />
          <el-table-column prop="qualityTarget" label="质量目标" min-width="110" />
          <el-table-column prop="bondStatus" label="保证金" min-width="90" />
          <el-table-column prop="confirmStatus" label="状态" min-width="110" />
        </el-table>
      </el-card>
    </div>

    <div class="right">
      <!-- U3：userId 取 auth store 的 User.id（消息 senderId = actor.userId，非 Supplier.id） -->
      <ChatPanel v-if="supplierId" :project-id="projectId" :supplier-id="supplierId" :supplier-name="supplierName" :user-id="authStore.user?.id ?? ''" />
      <el-card v-else-if="profileError" shadow="never">
        <el-empty description="会话加载失败" :image-size="64">
          <el-button size="small" type="primary" @click="retryProfile">重试</el-button>
        </el-empty>
      </el-card>
      <el-card v-else shadow="never"><div class="empty">加载供应商信息中…</div></el-card>
    </div>
    </template>
  </div>
</template>

<style scoped>
.left { display: flex; flex-direction: column; }
.hall { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.2fr); gap: 16px; }
.hall-error { grid-column: 1 / -1; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.name { font-weight: 700; line-height: 1.4; flex: 1; min-width: 0; }
.meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
/* 在场徽标：绿色浅底 hairline 药丸（徽标不用新拟态阴影，见 .impeccable.md 反模式），左对齐 */
.presence { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; background: #f0f9eb; border: 1px solid #e1f3d8; color: #529b2e; font-size: 12px; font-weight: 600; }
.presence .num { color: #529b2e; font-weight: 800; font-variant-numeric: tabular-nums; }
.actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
.records-card { margin-top: 16px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.records-card :deep(.el-card__header) { flex-shrink: 0; }
.records-card :deep(.el-card__body) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.records-card :deep(.el-table) { flex: 1; }
.records-head { display: flex; align-items: center; justify-content: space-between; }
.records-title { font-weight: 600; }
.records-count { color: #909399; font-size: 12px; font-variant-numeric: tabular-nums; }
.self-tag { margin-left: 6px; }
/* 供应商名称列允许换行（el-table 单元格默认 nowrap 截断，改用整列换行而非 tooltip） */
.records-card :deep(.col-supplier .cell) { white-space: normal; word-break: break-all; line-height: 1.5; }
.stage-hint { margin-top: 8px; color: #909399; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: #999; }
.mismatch { color: #e6a23c; font-weight: 600; }
/* ── 双信封 v2 解密卡片 ── */
.decrypt-card { margin-top: 16px; }
.pkg-hint { margin-top: 8px; color: #909399; font-size: 12px; line-height: 1.6; }
.seal-block { margin: 10px 0 14px; padding: 10px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #e4e7ed; }
.seal-title { margin-bottom: 8px; color: #606266; font-size: 12px; font-weight: 600; }
.seal-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.seal-role { min-width: 64px; color: #303133; font-size: 13px; }
.ukey-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.ukey-ok { color: #67c23a; font-size: 12px; font-weight: 600; }
.ukey-hint { color: #909399; font-size: 12px; }
.ukey-desc { margin: 0 0 10px; color: #606266; font-size: 13px; line-height: 1.6; }
.revealed { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 13px; }
.revealed b { color: #303133; font-variant-numeric: tabular-nums; }
@media (max-width: 960px) { .hall { grid-template-columns: 1fr; } }
/* 桌面端：网格撑满内容区高度，左右两列同高——右列聊天面板与左列唱标总表卡均延伸至页面底部（底边对齐） */
@media (min-width: 961px) {
  .hall { height: 100%; }
}
</style>
