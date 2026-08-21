<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import SpPageHero from '@/components/SpPageHero.vue'
import { KeyRound, ShieldCheck, Download, Upload, Plus, AlertTriangle, Lock, Unlock } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { MockUKeyAdapter, type StorageLike, type CertInfo } from '@water-erp/ukey'

const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)

// ── U盾介质状态 ──
const password = ref('')
const opening = ref(false)
const ukey = ref<MockUKeyAdapter | null>(null)
const ukeyCerts = ref<CertInfo[]>([])
const creating = ref(false)
const importing = ref(false)
const importFileRef = ref<HTMLInputElement | null>(null)

/** 绑定成功后在浏览器缓存证书公开信息（无任何私钥），供投标提交页恢复 certSn 参考 */
const BOUND_KEY = 'supplier_ukey_bound'
interface BoundInfo { certSn: string; certDn: string; publicKey: string; certId: string }
const boundInfo = ref<BoundInfo | null>(null)
function readBound(): BoundInfo | null {
  try {
    const raw = localStorage.getItem(BOUND_KEY)
    return raw ? JSON.parse(raw) as BoundInfo : null
  } catch { return null }
}
function writeBound(info: BoundInfo) {
  try { localStorage.setItem(BOUND_KEY, JSON.stringify(info)) } catch {}
}
function clearBound() {
  try { localStorage.removeItem(BOUND_KEY) } catch {}
}

/** MockUKeyAdapter 的 storage 适配（仅口令加密后的 keystore 落 localStorage） */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
}

// ── 服务端绑定记录 ──
interface ServerCertRow {
  id: string; certSn: string; certDn: string; publicKey: string; alg: string;
  bindingStatus: 'ACTIVE' | 'REVOKED'; boundAt: string; revokedAt: string | null;
}
const serverCerts = ref<ServerCertRow[]>([])
const binding = ref(false)
const revoking = ref(false)

const companyName = computed(() => supplierStore.profile?.name || '')
const activeServerCert = computed(() => serverCerts.value.find(c => c.bindingStatus === 'ACTIVE') ?? null)

onMounted(async () => {
  try {
    await Promise.all([supplierStore.fetchProfile(), refreshServerCerts()])
    boundInfo.value = readBound()
  } catch { error.value = true }
  finally { loading.value = false }
})

async function refreshServerCerts() {
  const res: any = await supplierApi.listMyCerts()
  serverCerts.value = Array.isArray(res) ? res : []
}

async function retryLoad() {
  error.value = false; loading.value = true
  try {
    await Promise.all([supplierStore.fetchProfile(), refreshServerCerts()])
    boundInfo.value = readBound()
  } catch { error.value = true }
  finally { loading.value = false }
}

// ── 开锁 ──
async function handleOpen() {
  if (!password.value) { ElMessage.warning('请输入 U盾口令'); return }
  opening.value = true
  try {
    const uk = await MockUKeyAdapter.open({ storage: ukeyStorage, password: password.value })
    ukey.value = uk
    ukeyCerts.value = await uk.listCertificates()
    ElMessage.success(ukeyCerts.value.length > 0 ? 'U盾已开锁' : '已创建空介质（尚未生成证书）')
  } catch (e: any) {
    ElMessage.error(e?.message || '开锁失败：口令不符或介质损坏')
  } finally { opening.value = false }
}

function lockUkey() {
  ukey.value = null
  ukeyCerts.value = []
  password.value = ''
}

// ── 新建证书 ──
async function handleCreateCert() {
  if (!ukey.value) { ElMessage.warning('请先开锁 U盾'); return }
  if (!companyName.value) { ElMessage.warning('未能获取企业名称，请稍后重试'); return }
  creating.value = true
  try {
    const cert = await ukey.value.createCertificate(companyName.value)
    ukeyCerts.value = await ukey.value.listCertificates()
    ElMessage.success(`已生成证书 ${cert.certSn}`)
  } catch (e: any) { ElMessage.error(e?.message || '生成证书失败') }
  finally { creating.value = false }
}

// ── 绑定 ──
async function handleBind(cert: CertInfo) {
  if (!cert.publicKey) { ElMessage.error('证书缺少公钥，无法绑定'); return }
  binding.value = true
  try {
    const res: any = await supplierApi.bindCert({ certSn: cert.certSn, certDn: cert.certDn, publicKey: cert.publicKey, alg: cert.alg ?? 'SM2' })
    // 换证语义：绑定新证时服务端自动把旧 ACTIVE 置 REVOKED——对旧证做幂等 revoke 查询
    // 依赖旧 certSn 的未开标提交数，警示保留旧介质
    const prevActive = serverCerts.value.find(c => c.bindingStatus === 'ACTIVE' && c.certSn !== cert.certSn)
    writeBound({ certSn: cert.certSn, certDn: cert.certDn, publicKey: cert.publicKey, certId: res?.cert?.id ?? '' })
    boundInfo.value = readBound()
    await Promise.all([refreshServerCerts(), supplierStore.fetchProfile()])
    ElMessage.success(`证书已绑定：${res?.cert?.certDn ?? cert.certDn}（主体与注册企业名称校验通过）`)
    if (prevActive) {
      try {
        const revoked: any = await supplierApi.revokeCert(prevActive.id)
        await refreshServerCerts()
        if (Number(revoked?.pendingSubmissions) > 0) {
          await ElMessageBox.alert(
            `旧证书 ${prevActive.certSn} 仍有 ${revoked.pendingSubmissions} 个未开标提交依赖其解密，请保留旧 U盾介质或导出文件，直至开标结束。`,
            '换证警示', { type: 'warning', confirmButtonText: '我知道了' },
          )
        }
      } catch { /* 幂等查询失败不阻断换证流程 */ }
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '绑定失败')
  } finally { binding.value = false }
}

// ── 解绑 ──
async function handleRevoke(row: ServerCertRow) {
  await ElMessageBox.confirm(`确定解绑证书 ${row.certSn} 吗？解绑后该证书将无法再用于投标签名。`, '确认解绑', { type: 'warning' })
  revoking.value = true
  try {
    const res: any = await supplierApi.revokeCert(row.id)
    await refreshServerCerts()
    if (boundInfo.value?.certSn === row.certSn) { clearBound(); boundInfo.value = null }
    if (Number(res?.pendingSubmissions) > 0) {
      await ElMessageBox.alert(
        `仍有 ${res.pendingSubmissions} 个未开标提交依赖此证书，请保留 U盾介质以便开标解密。`,
        '解绑警示', { type: 'warning', confirmButtonText: '我知道了' },
      )
    } else {
      ElMessage.success('证书已解绑')
    }
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.response?.data?.error || '解绑失败')
  } finally { revoking.value = false }
}

// ── 导出介质文件 ──
const exportVisible = ref(false)
const exportPassword = ref('')
const exportPassword2 = ref('')
const exporting = ref(false)

async function handleExport() {
  if (!ukey.value) { ElMessage.warning('请先开锁 U盾'); return }
  if (exportPassword.value.length < 6) { ElMessage.warning('导出口令至少 6 位'); return }
  if (exportPassword.value !== exportPassword2.value) { ElMessage.warning('两次输入的口令不一致'); return }
  exporting.value = true
  try {
    const content = await ukey.value.exportFile(exportPassword.value)
    const blob = new Blob([content], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safe = (companyName.value || 'supplier').replace(/[\\/:*?"<>|]/g, '_')
    a.download = `U盾介质-${safe}-${dayjs().format('YYYYMMDD')}.ukey`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    exportVisible.value = false
    ElMessage.success('介质文件已导出，请妥善保管（私钥仅以口令加密形态包含其中）')
  } catch (e: any) { ElMessage.error(e?.message || '导出失败') }
  finally { exporting.value = false }
}

// ── 导入介质文件 ──
const importPassword = ref('')
async function handleImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!importPassword.value) { ElMessage.warning('请输入该介质文件的导出口令'); input.value = ''; return }
  importing.value = true
  try {
    const text = await file.text()
    const uk = await MockUKeyAdapter.importFile(text, importPassword.value, ukeyStorage)
    ukey.value = uk
    password.value = importPassword.value
    ukeyCerts.value = await uk.listCertificates()
    ElMessage.success(`介质导入成功（${ukeyCerts.value.length} 张证书）`)
  } catch (e: any) { ElMessage.error(e?.message || '导入失败：口令不符或文件损坏') }
  finally { importing.value = false; input.value = ''; importPassword.value = '' } // fix round 1 ⑦：口令用完即清
}

function certServerRow(certSn: string): ServerCertRow | undefined {
  return serverCerts.value.find(c => c.certSn === certSn)
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else>
      <SpPageHero :icon="KeyRound" title="U盾管理" sub="管理投标加密证书与口令介质。证书绑定后，标书将以双层加密信封投递，报价密封至开标时揭示。">
        <template #actions>
          <el-button v-if="ukey" plain size="large" @click="lockUkey"><el-icon><Lock /></el-icon>锁定介质</el-button>
        </template>
      </SpPageHero>

      <div class="ukey-grid">
        <!-- ═══ 口令介质 ═══ -->
        <div class="neu-card detail-card">
          <div class="card-header">
            <span class="card-title">口令介质</span>
            <span class="ukey-state" :class="ukey ? 'open' : ''">{{ ukey ? `已开锁 · ${ukeyCerts.length} 张证书` : '未开锁' }}</span>
          </div>

          <template v-if="!ukey">
            <div class="open-row">
              <el-input v-model="password" type="password" show-password placeholder="输入 U盾口令（首次使用将创建新介质）" size="large" @keyup.enter="handleOpen" />
              <el-button type="primary" size="large" :loading="opening" @click="handleOpen"><el-icon><Unlock /></el-icon>开锁</el-button>
            </div>
            <div class="file-hint">已有导出文件？</div>
            <div class="import-row">
              <el-input v-model="importPassword" type="password" show-password placeholder="介质文件口令" size="large" style="flex:1" />
              <el-button size="large" :loading="importing" @click="importFileRef?.click()"><el-icon><Upload /></el-icon>导入介质文件</el-button>
              <input ref="importFileRef" type="file" accept=".ukey" style="display:none" @change="handleImportFile" />
            </div>
          </template>

          <template v-else>
            <div class="cert-toolbar">
              <el-button size="large" :loading="creating" @click="handleCreateCert"><el-icon><Plus /></el-icon>新建证书</el-button>
              <el-button size="large" @click="exportVisible = true"><el-icon><Download /></el-icon>导出介质</el-button>
              <span class="file-hint">证书主体 CN 自动取注册企业名称，绑定校验 CN↔企业名一致性</span>
            </div>

            <div v-if="ukeyCerts.length === 0" class="ukey-empty">介质内暂无证书，点击「新建证书」生成（label={{ companyName || '企业名称' }}）</div>
            <div v-else class="cert-list">
              <div v-for="cert in ukeyCerts" :key="cert.certSn" class="cert-row">
                <div class="cert-main">
                  <span class="cert-sn">{{ cert.certSn }}</span>
                  <span class="cert-dn">{{ cert.certDn }}</span>
                </div>
                <div class="cert-actions">
                  <el-tag v-if="certServerRow(cert.certSn)?.bindingStatus === 'ACTIVE'" type="success" effect="plain">已绑定</el-tag>
                  <el-tag v-else-if="certServerRow(cert.certSn)?.bindingStatus === 'REVOKED'" type="info" effect="plain">已解绑</el-tag>
                  <!-- fix round 1 ④：不因已有 ACTIVE 证书禁用——绑定新证即换证（服务端自动撤销旧证），
                       handleBind 的 prevActive 警示分支由此可达 -->
                  <el-button
                    v-if="certServerRow(cert.certSn)?.bindingStatus !== 'ACTIVE'"
                    type="primary" size="small" :loading="binding"
                    :title="activeServerCert ? '绑定后原生效证书自动撤销，留意换证警示' : ''"
                    @click="handleBind(cert)"
                  >{{ activeServerCert ? '换证绑定' : '绑定' }}</el-button>
                </div>
              </div>
            </div>
          </template>

          <div class="ukey-security-note">
            <ShieldCheck :size="14" :stroke-width="1.75" />
            私钥仅以口令加密形态存储于本浏览器介质，永不明文落盘；请导出备份并妥善保管，丢失介质将无法解密已投递标书。
          </div>
        </div>

        <!-- ═══ 服务端绑定记录 ═══ -->
        <div class="neu-card detail-card">
          <div class="card-header">
            <span class="card-title">平台绑定记录</span>
            <el-button text type="primary" @click="refreshServerCerts">刷新</el-button>
          </div>

          <div v-if="serverCerts.length === 0" class="ukey-empty">
            暂无绑定记录。开锁介质并生成证书后，点击「绑定」完成企业身份与证书的关联。
          </div>
          <div v-else class="cert-list">
            <div v-for="row in serverCerts" :key="row.id" class="cert-row server">
              <div class="cert-main">
                <span class="cert-sn">{{ row.certSn }}</span>
                <span class="cert-dn">{{ row.certDn }}</span>
                <span class="cert-time">
                  {{ row.bindingStatus === 'ACTIVE' ? `绑定于 ${dayjs(row.boundAt).format('YYYY-MM-DD HH:mm')}` : `撤销于 ${row.revokedAt ? dayjs(row.revokedAt).format('YYYY-MM-DD HH:mm') : '--'}` }}
                </span>
              </div>
              <div class="cert-actions">
                <el-tag :type="row.bindingStatus === 'ACTIVE' ? 'success' : 'info'" effect="plain">{{ row.bindingStatus === 'ACTIVE' ? '生效中' : '已撤销' }}</el-tag>
                <el-button v-if="row.bindingStatus === 'ACTIVE'" type="danger" plain size="small" :loading="revoking" @click="handleRevoke(row)">解绑</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 导出口令对话框 ═══ -->
      <!-- fix round 1 ⑦：关闭后清空口令 ref，口令不残留 -->
      <el-dialog v-model="exportVisible" title="导出介质文件" width="420px" destroy-on-close @closed="exportPassword = ''; exportPassword2 = ''">
        <p class="export-desc">导出文件包含全部证书（私钥经口令加密）。可跨浏览器/跨设备导入，请妥善保管。</p>
        <el-form label-width="90px">
          <el-form-item label="新口令">
            <el-input v-model="exportPassword" type="password" show-password placeholder="至少 6 位" />
          </el-form-item>
          <el-form-item label="确认口令">
            <el-input v-model="exportPassword2" type="password" show-password placeholder="再次输入" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="exportVisible = false">取消</el-button>
          <el-button type="primary" :loading="exporting" @click="handleExport">导出下载</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.ukey-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
@media (max-width: 1100px) { .ukey-grid { grid-template-columns: 1fr; } }

.detail-card { padding: 24px; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; box-shadow: inset 0 -1px 0 var(--hairline); }
.card-title { font-size: 15px; font-weight: 800; color: var(--foreground); }

.ukey-state {
  font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 8px;
  color: var(--muted-foreground); background: color-mix(in oklab, var(--hairline) 40%, transparent);
}
.ukey-state.open { color: var(--success); background: color-mix(in oklab, var(--success) 12%, transparent); }

.open-row { display: flex; gap: 10px; margin-bottom: 14px; }
.import-row { display: flex; gap: 10px; margin-top: 8px; }
.file-hint { font-size: 12px; color: var(--muted-foreground); }

.cert-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.cert-list { display: flex; flex-direction: column; gap: 8px; }
.cert-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-radius: 10px; background: var(--surface);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 3px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.6);
}
.cert-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cert-sn { font-size: 12px; font-weight: 700; color: var(--brand); font-family: 'SF Mono', 'JetBrains Mono', monospace; }
.cert-dn { font-size: 13px; font-weight: 600; color: var(--foreground); }
.cert-time { font-size: 11px; color: var(--muted-foreground); }
.cert-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.ukey-empty {
  padding: 28px 16px; text-align: center; font-size: 13px; color: var(--muted-foreground);
  border: 1px dashed var(--hairline); border-radius: 12px;
}
.ukey-security-note {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 16px; padding-top: 14px; box-shadow: inset 0 1px 0 var(--hairline);
  font-size: 12px; line-height: 1.6; color: var(--muted-foreground);
}
.ukey-security-note svg { flex-shrink: 0; margin-top: 2px; color: var(--brand); }
.export-desc { margin: 0 0 14px; font-size: 13px; color: var(--muted-foreground); line-height: 1.6; }
</style>
