<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import { announcementApi } from '@/api/announcement'
import { bidApi } from '@/api/bid'
import { uploadFile } from '@/api/upload'
import SpPageHero from '@/components/SpPageHero.vue'
import { FileText, AlertTriangle, Lock, Upload, Download } from 'lucide-vue-next'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const bidStore = useBidStore()
const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const projectId = computed(() => route.params.id as string)
const isListMode = computed(() => route.query.from === 'list')
const backTo = computed(() => isListMode.value ? '/bids' : '/my-bids')
const backLabel = computed(() => isListMode.value ? '返回可投标项目' : '返回投标进展')

const STAGES = ['DOWNLOAD','SUBMIT','OPENING','EVALUATING','ARCHIVED'] as const
const stageMap: Record<string, { label: string; color: string; guide: string }> = {
  DOWNLOAD:    { label: '文件下载',  color: '#0891b2', guide: '可下载招标文件、查看项目范围与资质要求，提前准备投标材料。' },
  SUBMIT:      { label: '加密投递',  color: '#c00a6b', guide: '标书已开放投递，请在截止时间前完成标书文件加密上传与提交。' },
  OPENING:     { label: '在线开标',  color: '#d97706', guide: '项目已进入开标流程，届时可在线参与开标确认，核实开标信息。' },
  EVALUATING:  { label: '专家评标',  color: '#7c3aed', guide: '评标委员会正在对标书进行综合评审，请耐心等候评标结果公示。' },
  ARCHIVED:    { label: '已归档',    color: '#059669', guide: '招投标流程已完成并归档，可查看最终评标结果与中标公示。' },
}
const project = computed(() => bidStore.currentProject)
const stageIdx = computed(() => Math.max(0, STAGES.indexOf((project.value?.stage || 'DOWNLOAD') as any)))
const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => { if (!project.value || !isApproved.value) return false; return ['DOWNLOAD', 'SUBMIT'].includes(project.value.stage) && new Date(project.value.deadline) > new Date() })
const showSupplierCount = computed(() => ['OPENING','EVALUATING','ARCHIVED'].includes(project.value?.stage || ''))
const supplierCount = computed(() => project.value?._count?.suppliers || 0)

const heroSub = computed(() => {
  const p = project.value
  if (!p) return ''
  const pub = p.announcement?.publishDate ? ` · ${dayjs(p.announcement.publishDate).format('YYYY-MM-DD')} 公告` : ''
  return `${p.projectCode} · ${p.procurementMethod}${pub}`
})

// ── 公告结构化信息（来自 announcement.metadata）──
const announceMeta = computed(() => (project.value?.announcement?.metadata || null) as any)
function fmtBudget(raw: any): string {
  if (raw == null || raw === '') return ''
  const n = Number(raw)
  if (isNaN(n)) return String(raw)
  if (n >= 10000) return `${(n / 10000).toFixed(0)} 万元`
  return `${n} 元`
}
function fmtMetaDate(raw: any): string {
  if (!raw) return ''
  const d = dayjs(raw)
  return d.isValid() ? d.format('YYYY/MM/DD HH:mm') : String(raw)
}
// 仅展示有值的字段
const metaFields = computed(() => {
  const m = announceMeta.value
  if (!m) return []
  const fields: { label: string; value: string; mono?: boolean; strong?: boolean }[] = []
  if (m.projectCode) fields.push({ label: '项目编号', value: m.projectCode, mono: true })
  if (m.method) fields.push({ label: '招标方式', value: m.method })
  if (m.budget != null && m.budget !== '') fields.push({ label: '预算金额', value: fmtBudget(m.budget), strong: true })
  if (m.deadline) fields.push({ label: '报名/投标截止', value: fmtMetaDate(m.deadline), strong: true })
  if (m.openTime) fields.push({ label: '开标时间', value: fmtMetaDate(m.openTime), strong: true })
  if (m.contact) fields.push({ label: '联系方式', value: m.contact })
  return fields
})

// ── 招标文件 ──
const bidDoc = ref<any>(null); const bidDocLoading = ref(false); const paying = ref(false); const downloading = ref(false)
const payDialog = ref(false); const paymentRef = ref('')
async function loadBidDoc() { bidDocLoading.value = true; try { bidDoc.value = await bidApi.getProjectBidDocument(projectId.value) as any } catch { bidDoc.value = null } bidDocLoading.value = false }
async function doPay() { if (!bidDoc.value?.announcementId) return; paying.value = true; try { await announcementApi.payBidDocument(bidDoc.value.announcementId, paymentRef.value || undefined); ElMessage.success('付款凭证已提交'); payDialog.value = false; paymentRef.value = ''; await loadBidDoc() } catch (e: any) { ElMessage.error(e?.message || '提交失败') } paying.value = false }
async function doDownload() { if (!bidDoc.value?.announcementId) return; downloading.value = true; try { const { blob, fileName } = await announcementApi.downloadBidDocument(bidDoc.value.announcementId); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url); await loadBidDoc() } catch (e: any) { ElMessage.error(e?.message || '下载失败') } downloading.value = false }

// ── 书面交流（来函 + 可选附件；澄清模块保持单向，无实时推送）──
const questionText = ref(''); const questionPosting = ref(false)
const attachAssetId = ref(''); const attachUploadRef = ref<any>(null); const attachUploading = ref(false)
const replyOpen = ref<string | null>(null); const replyText = ref(''); const replyPosting = ref(false)
// U5：catch 仅保留状态复位——业务错误消息已由 axios 拦截器统一弹出（data.error），不再重复 toast
async function postQuestion() { if (!questionText.value.trim()) { ElMessage.warning('请输入函件内容'); return }; questionPosting.value = true; try { await bidApi.createQuestion(projectId.value, questionText.value.trim(), attachAssetId.value || undefined); ElMessage.success('来函已提交'); questionText.value = ''; attachAssetId.value = ''; attachUploadRef.value?.clearFiles(); await bidStore.fetchProject(projectId.value) } catch { /* 拦截器已提示 */ } questionPosting.value = false }
function openReply(id: string) { replyOpen.value = id; replyText.value = '' }
function closeReply() { replyOpen.value = null; replyText.value = '' }
async function postReply(id: string) { if (!replyText.value.trim()) { ElMessage.warning('请输入回复'); return }; replyPosting.value = true; try { await bidApi.createQuestion(projectId.value, replyText.value.trim()); ElMessage.success('回复已提交'); closeReply(); await bidStore.fetchProject(projectId.value) } catch { /* 拦截器已提示 */ } replyPosting.value = false }
// U6：附件上传失败 → toast + 清 assetId；re-throw 让 el-upload 将文件标红
async function handleAttachUpload(opt: any) {
  attachUploading.value = true
  try {
    const asset = await uploadFile(opt.file as File, 'clarification')
    attachAssetId.value = asset.id
  } catch (e: any) {
    attachAssetId.value = ''
    // 带 response 的错误已由 axios 拦截器统一弹出；仅补无 response（断网/超时）这一空洞，避免双弹窗（M2）
    if (!e?.response) ElMessage.error('附件上传失败，请检查网络后重试')
    throw e
  } finally {
    attachUploading.value = false
  }
}

// 将纯文本公告格式化为 HTML（处理中文招标公告结构）
function formatContent(raw: string): string {
  if (!raw) return ''
  // 如果已经是 HTML，直接返回
  if (/<[a-zA-Z][^>]*>/.test(raw)) return raw
  // 先按一、二、三级标题拆，其余为正文段落
  return raw
    .split('\n')
    .map(line => {
      let t = line.trim()
      if (!t) return ''
      // 一级标题：一、 二、 三、...
      if (/^[一二三四五六七八九十]+、/.test(t)) return `<h2>${t}</h2>`
      // 二级标题：X.X 如 2.1 、（一）（二）
      if (/^\d+\.\d+\s/.test(t)) return `<h3>${t}</h3>`
      if (/^（[一二三四五六七八九十]+）/.test(t)) return `<h3>${t}</h3>`
      // 正文段落
      return `<p>${t}</p>`
    })
    .join('\n')
}

onMounted(async () => { try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } }
function goToSubmit() { if (!supplierStore.profile || supplierStore.profile?.status !== 'APPROVED') { ElMessage.warning('只有已入库供应商可以提交标书'); return } router.push(`/bids/${projectId.value}/submit`) }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <button type="button" class="neu-link back-link" @click="router.push(backTo)"><el-icon><ArrowLeft /></el-icon>{{ backLabel }}</button>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else-if="project">
      <!-- ═══ Hero ═══ -->
      <SpPageHero :icon="FileText" :title="project.name" :sub="heroSub">
        <template #actions>
          <button class="neu-btn-primary" :disabled="!canSubmit" @click="goToSubmit" style="height:40px;padding:0 20px">
            <Upload :size="14" :stroke-width="1.75" />{{ canSubmit ? '提交标书' : '不可投标' }}
          </button>
        </template>
      </SpPageHero>

      <!-- ═══ 阶段进度 + 指引（非列表模式）═══ -->
      <div v-if="!isListMode" class="stage-card">
        <div class="stage-bar">
          <div
            v-for="(key, i) in STAGES"
            :key="key"
            class="sb"
            :class="{ done: i < stageIdx, cur: i === stageIdx }"
            :style="{ '--sc': stageMap[key].color }"
          ><span class="sb-dot" /><span class="sb-lbl">{{ stageMap[key].label }}</span></div>
        </div>
        <div class="stage-msg" :style="{ '--sc': stageMap[project.stage]?.color || 'var(--brand)' }">
          <span class="sm-badge"><span class="sm-dot" />{{ stageMap[project.stage]?.label }}</span>
          <span class="sm-text">{{ stageMap[project.stage]?.guide || '' }}</span>
        </div>
      </div>

      <!-- ═══ 关键信息（非列表模式）═══ -->
      <div v-if="!isListMode" class="info-bar">
        <span>截止<strong :class="{ 'danger': project.stage === 'SUBMIT' }">{{ dayjs(project.deadline).format('MM-DD HH:mm') }}</strong></span>
        <span>开标<strong>{{ dayjs(project.openTime).format('MM-DD HH:mm') }}</strong></span>
        <span>保证金<strong>{{ project.bondRequired && project.bondAmount ? '¥'+Number(project.bondAmount).toLocaleString() : '无' }}</strong></span>
        <span v-if="showSupplierCount">投标方<strong>{{ supplierCount }} 家</strong></span>
      </div>

      <!-- ═══ 公告正文 ═══ -->
      <div class="content-card neu-card">
        <!-- 公告结构化信息（镜像信息发布中心） -->
        <div v-if="metaFields.length" class="cc-meta">
          <div v-for="f in metaFields" :key="f.label" class="cc-meta-item">
            <span class="cc-meta-label">{{ f.label }}</span>
            <span class="cc-meta-value" :class="{ mono: f.mono, strong: f.strong }">{{ f.value }}</span>
          </div>
        </div>

        <!-- 招标条件 -->
        <div v-if="project.scope || project.qualification || project.contact || project.qualityRequirement" class="cc-conds">
          <div v-if="project.scope" class="cc-cond">
            <span class="cc-cond-hd">招标范围</span>
            <p class="cc-cond-bd">{{ project.scope }}</p>
          </div>
          <div v-if="project.qualification" class="cc-cond">
            <span class="cc-cond-hd">资质要求</span>
            <p class="cc-cond-bd">{{ project.qualification }}</p>
          </div>
          <div v-if="project.qualityRequirement" class="cc-cond">
            <span class="cc-cond-hd">质量要求</span>
            <p class="cc-cond-bd">{{ project.qualityRequirement }}</p>
          </div>
          <div v-if="project.contact" class="cc-cond">
            <span class="cc-cond-hd">联系方式</span>
            <p class="cc-cond-bd">{{ project.contact }}</p>
          </div>
        </div>

        <div v-if="project.announcement?.content" class="cc-body" v-html="formatContent(project.announcement.content)" />
        <div v-else class="cc-empty">
          <FileText :size="20" :stroke-width="1.75" />
          <p>暂无公告正文</p>
        </div>
      </div>

      <!-- ═══ 招标文件 + 书面交流（非列表模式）═══ -->
      <div v-if="!isListMode" class="bottom-grid">
        <!-- 招标文件 -->
        <div class="neu-card bottom-card" v-loading="bidDocLoading">
          <div class="bc-hd">招标文件</div>
          <template v-if="bidDoc">
            <div class="bdoc">
              <Lock :size="14" :stroke-width="1.75" class="bdoc-icon" />
              <span class="bdoc-name">{{ bidDoc.title }}</span>
            </div>
            <div class="bdoc-acts">
              <el-alert v-if="!bidDoc.eligible" :title="'无法下载：' + bidDoc.reason" type="error" :closable="false" show-icon />
              <template v-else>
                <el-alert v-if="bidDoc.needPayment" title="需付费下载" type="warning" :closable="false" show-icon />
                <el-alert v-else-if="bidDoc.requirePayment && !bidDoc.paid" title="付款凭证已提交，等待确认" type="info" :closable="false" show-icon />
                <button v-if="bidDoc.needPayment" class="neu-btn-soft" @click="payDialog = true">提交付款凭证</button>
                <button v-if="bidDoc.canDownload" class="neu-btn-primary" :disabled="downloading" @click="doDownload"><Download :size="13" :stroke-width="1.75" />下载招标文件</button>
              </template>
            </div>
          </template>
          <div v-else-if="!bidDocLoading" class="bc-empty">暂无招标文件</div>
        </div>

        <!-- 书面交流 -->
        <div class="neu-card bottom-card">
          <div class="bc-hd">书面交流</div>
          <p class="cq-desc">如需获取信息，可提交书面函件（支持附件），或致电项目联系人</p>
          <div class="cq-ask">
            <el-input v-model="questionText" placeholder="填写书面函件内容…" :rows="2" type="textarea" size="small" />
            <!-- U6：附件上传进行中禁用提交，防裸提交丢附件 -->
            <button class="neu-btn-xs cq-submit-btn" :disabled="questionPosting || attachUploading" @click="postQuestion">提交</button>
          </div>
          <div class="cq-attach">
            <el-upload
              ref="attachUploadRef"
              :auto-upload="true"
              :limit="1"
              :http-request="handleAttachUpload"
              :on-exceed="() => ElMessage.warning('仅支持 1 个附件')"
              :on-remove="() => (attachAssetId.value = '')"
            >
              <el-button size="small">添加附件</el-button>
            </el-upload>
          </div>
          <div v-if="project.clarifications?.length" class="cq-list">
            <div v-for="c in project.clarifications" :key="c.id" class="cq-item">
              <div class="cq-head">
                <el-tag :type="c.type === 'question' ? 'info' : 'warning'" size="small" effect="plain">{{ c.type === 'question' ? '答疑' : '澄清' }}</el-tag>
                <span class="cq-issuer">{{ c.issuer }}</span>
                <span class="cq-time">{{ dayjs(c.createdAt).format('MM-DD HH:mm') }}</span>
              </div>
              <div class="cq-text">{{ c.question }}</div>
              <div v-if="c.reply" class="cq-reply"><el-tag type="success" size="small" effect="plain">回复</el-tag><span>{{ c.reply }}</span></div>
              <div class="cq-act">
                <button v-if="replyOpen !== c.id" class="neu-btn-xs" @click="openReply(c.id)">回复</button>
                <div v-else class="cq-reply-box">
                  <el-input v-model="replyText" placeholder="输入回复…" :rows="2" type="textarea" size="small" />
                  <span class="cq-reply-btns">
                    <button class="neu-btn-xs is-success" :disabled="replyPosting" @click="postReply(c.id)">发送</button>
                    <button class="neu-btn-xs" @click="closeReply">取消</button>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="bc-empty">暂无答疑</div>
        </div>
      </div>

      <el-dialog v-model="payDialog" title="提交付款凭证" width="420px">
        <el-form><el-form-item label="付款凭证/流水号"><el-input v-model="paymentRef" placeholder="如：银行流水号" /></el-form-item></el-form>
        <template #footer><el-button @click="payDialog = false">取消</el-button><el-button type="primary" :loading="paying" @click="doPay">提交</el-button></template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
/* ══════ 基础 ══════ */
.back-link { margin-bottom: 16px; }
.danger { color: var(--danger) !important; }

/* ══════ 阶段进度 + 指引（单卡） ══════ */
.stage-card {
  margin-top: 16px; border-radius: 14px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.stage-bar {
  display: flex; height: 50px;
}
.sb {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  font-size: 11px; font-weight: 600; color: var(--muted-foreground);
  border-right: 1px solid var(--hairline); transition: all .3s;
}
.sb:last-child { border-right: none; }
.sb.done    { background: color-mix(in oklab, var(--sc) 20%, transparent); color: var(--sc); border-right-color: color-mix(in oklab, var(--sc) 15%, oklch(0.92 0.02 258)); }
.sb.cur     { background: color-mix(in oklab, var(--sc) 16%, transparent); color: var(--sc); font-weight: 800; box-shadow: inset 0 -3px 0 var(--sc); border-right-color: color-mix(in oklab, var(--sc) 10%, oklch(0.92 0.02 258)); }
.sb-dot     { width: 7px; height: 7px; border-radius: 50%; background: var(--hairline); flex-shrink: 0; transition: all .3s; }
.sb.done .sb-dot { background: var(--sc); box-shadow: 0 0 0 2px color-mix(in oklab, var(--sc) 18%, transparent); }
.sb.cur  .sb-dot { background: var(--sc); box-shadow: 0 0 0 4px color-mix(in oklab, var(--sc) 20%, transparent), 0 0 6px color-mix(in oklab, var(--sc) 25%, transparent); animation: dotPulse 2.4s ease-in-out infinite; }
@keyframes dotPulse {
  0%,100% { box-shadow: 0 0 0 4px color-mix(in oklab, var(--sc) 20%, transparent), 0 0 6px color-mix(in oklab, var(--sc) 25%, transparent); }
  50%     { box-shadow: 0 0 0 7px color-mix(in oklab, var(--sc) 8%, transparent), 0 0 12px color-mix(in oklab, var(--sc) 15%, transparent); }
}

/* 阶段指引 */
.stage-msg {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-top: 1px solid var(--hairline);
  background: color-mix(in oklab, var(--sc) 5%, transparent);
}
.sm-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; flex-shrink: 0; color: var(--sc); }
.sm-dot   { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.sm-text  { flex: 1; font-size: 12px; line-height: 1.5; color: var(--foreground); }

/* ══════ 关键信息条 ══════ */
.info-bar {
  display: flex; flex-wrap: wrap; gap: 24px;
  margin-top: 16px; padding: 12px 24px; border-radius: 12px;
  background: linear-gradient(180deg, oklch(0.993 0.008 258), oklch(0.975 0.012 258));
  box-shadow: 3px 3px 8px oklch(0.55 0.03 258 / 0.07), -2px -2px 6px oklch(1 0 0 / 0.75), inset 0 1px 0 oklch(1 0 0 / 0.6);
  font-size: 12px; font-variant-numeric: tabular-nums;
}
.info-bar > span { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); }
.info-bar > span strong { font-size: 13px; font-weight: 700; color: var(--foreground); }

/* ══════ 正文卡片 ══════ */
.content-card {
  margin-top: 16px; padding: 28px;
}
/* 公告结构化信息条 — 镜像信息发布中心，仅展示有值字段 */
.cc-meta {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px 14px;
  padding-bottom: 18px; margin-bottom: 18px;
  box-shadow: inset 0 -1px 0 var(--hairline);
}
.cc-meta-item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cc-meta-label { font-size: 10px; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.08em; }
.cc-meta-value { font-size: 14px; color: var(--foreground); line-height: 1.5; word-break: break-word; }
.cc-meta-value.mono { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--brand); font-weight: 700; }
.cc-meta-value.strong { font-weight: 800; font-variant-numeric: tabular-nums; }
.cc-conds {
  display: flex; flex-direction: column; gap: 10px;
  padding-bottom: 18px; margin-bottom: 18px;
  box-shadow: inset 0 -1px 0 var(--hairline);
}
.cc-cond {
  border-radius: 8px; padding: 10px 14px;
  background: color-mix(in oklab, var(--brand) 5%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.3), inset 1px 1px 3px oklch(0.55 0.03 258 / 0.04), inset -1px -1px 3px oklch(1 0 0 / 0.5);
}
.cc-cond-hd { display: block; font-size: 10px; font-weight: 700; color: var(--brand); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
.cc-cond-bd { margin: 0; font-size: 12px; line-height: 1.6; color: var(--foreground); white-space: pre-wrap; }
.cc-body { font-size: 14px; line-height: 1.85; color: var(--foreground); word-break: break-word; }
.cc-body :deep(table) { width: 100%; border-collapse: collapse; margin: 12px 0; }
.cc-body :deep(td), .cc-body :deep(th) { border: 1px solid var(--hairline); padding: 7px 10px; font-size: 12px; }
.cc-body :deep(th) { background: color-mix(in oklab, var(--muted-foreground) 6%, transparent); font-weight: 700; }
.cc-body :deep(h2) { font-size: 16px; font-weight: 800; margin: 20px 0 10px; color: var(--foreground); }
.cc-body :deep(h3) { font-size: 14px; font-weight: 700; margin: 16px 0 8px; color: var(--foreground); }
.cc-body :deep(p)  { margin: 0 0 10px; }
.cc-body :deep(p:last-child) { margin-bottom: 0; }
.cc-body :deep(ul), .cc-body :deep(ol) { padding-left: 18px; margin: 6px 0; }
.cc-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 40px 0; color: var(--muted-foreground);
}
.cc-empty p { margin: 0; font-size: 13px; font-weight: 600; }

/* ══════ 底部双栏 ══════ */
.bottom-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start;
  margin-top: 16px;
}
.bottom-card { padding: 18px; }
.bc-hd {
  font-size: 11px; font-weight: 800; color: var(--muted-foreground);
  text-transform: uppercase; letter-spacing: .06em;
  margin-bottom: 14px; padding-bottom: 10px;
  box-shadow: inset 0 -1px 0 var(--hairline);
}
.bc-empty { text-align: center; padding: 20px 0; font-size: 12px; color: var(--muted-foreground); }

/* 招标文件 */
.bdoc       { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / .5), 1px 1px 3px oklch(.55 .03 258 / .06), -1px -1px 2px oklch(1 0 0 / .6); }
.bdoc-icon  { color: var(--brand); flex-shrink: 0; }
.bdoc-name  { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bdoc-meta  { font-size: 11px; color: var(--muted-foreground); flex-shrink: 0; }
.bdoc-acts  { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.bdoc-acts .neu-btn-soft, .bdoc-acts .neu-btn-primary { justify-content: center; }

/* 书面交流 */
.cq-desc   { margin: 2px 0 10px; font-size: 12px; line-height: 1.6; color: var(--muted-foreground); }
.cq-ask   { display: flex; gap: 8px; margin-bottom: 12px; }
.cq-submit-btn { min-width: 64px; flex-shrink: 0; align-self: center; }
.cq-attach { margin: -4px 0 12px; }
.cq-list  { display: flex; flex-direction: column; }
.cq-item  { padding: 9px 0; border-bottom: 1px solid var(--hairline); }
.cq-item:last-child { border-bottom: none; }
.cq-head   { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.cq-issuer { font-size: 11px; color: var(--muted-foreground); }
.cq-time   { font-size: 10px; color: var(--muted-foreground); margin-left: auto; font-variant-numeric: tabular-nums; }
.cq-text   { font-size: 12px; line-height: 1.6; color: var(--foreground); }
.cq-reply  { display: flex; align-items: flex-start; gap: 6px; margin-top: 5px; font-size: 12px; line-height: 1.6; color: var(--foreground); }
.cq-act    { margin-top: 8px; }
.cq-reply-box  { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
.cq-reply-btns { display: flex; gap: 6px; align-self: flex-end; }

@media (max-width: 860px) {
  .bottom-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .sb-lbl { display: none; }
  .sb.cur .sb-lbl { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .sb.cur .sb-dot { animation: none; }
}
</style>
