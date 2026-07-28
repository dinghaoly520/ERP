<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { createDialogLeaveGuard } from '@/composables'
import SpPageHero from '@/components/SpPageHero.vue'
import { Building2, AlertTriangle } from 'lucide-vue-next'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true); const error = ref(false)
const activeTab = ref<'info' | 'quals' | 'contacts'>('info')

// ═══════════════════ 企业信息 ═══════════════════
async function copyCreditCode() {
  if (!supplierStore.profile?.creditCode) return
  try { await navigator.clipboard.writeText(supplierStore.profile.creditCode); ElMessage.success('已复制统一社会信用代码') } catch { ElMessage.warning('复制失败，请手动选择') }
}
const statusText: Record<string,string> = {PENDING:'待审核',APPROVED:'已入库',REJECTED:'不通过',RETURNED:'退回补正',DISABLED:'已停用',BLACKLIST:'黑名单'}
const profileRows = computed(() => {
  const p = supplierStore.profile; if (!p) return []
  return [{label:'统一社会信用代码',value:p.creditCode},{label:'企业类型',value:p.enterpriseType},{label:'法定代表人',value:p.legalPerson},{label:'注册时间',value:dayjs(p.createdAt).format('YYYY-MM-DD')},{label:'注册地址',value:p.registeredAddress,wide:true},{label:'经营范围',value:p.businessScope,wide:true},{label:'更新时间',value:dayjs(p.updatedAt).format('YYYY-MM-DD HH:mm')}]
})
const profileTags = computed(() => {
  const tags = (supplierStore.profile as any)?.tags
  return (Array.isArray(tags) && tags.length > 0) ? tags : []
})

// ═══════════════════ 资质与证照 ═══════════════════
const qualsLoading = ref(false); const qualsErr = ref(false)
const qualDialogVisible = ref(false); const qualDialogLoading = ref(false)
const qualUploading = ref(false); const qualUploadProgress = ref<number | null>(null)
const uploadedMeta = ref<FileAssetResponse | null>(null)
const qualForm = ref({ type: '', name: '', fileUrl: '', validFrom: '', validTo: '' })
const qualFormDirty = ref(false)
const qualGuard = createDialogLeaveGuard(qualFormDirty)
function qMarkDirty() { qualFormDirty.value = true }
async function qClosePanel() { await qualGuard(() => { qualDialogVisible.value = false; qualFormDirty.value = false }) }

const qualTypes = ['营业执照','资质证书','安全生产许可证','质量管理体系认证','环境管理体系认证','职业健康安全管理体系认证','其他']
// 颜色统一映射到 cgzxui 设计令牌，每个类型对应的 oklch 值是令牌的实际色值
const qualTypeTokens: Record<string, { token: string; value: string; icon: string }> = {
  '营业执照':               { token: 'var(--brand)',        value: 'oklch(0.5 0.16 258)', icon: 'Stamp' },
  '资质证书':               { token: 'var(--brand-deep)',   value: 'oklch(0.42 0.16 258)', icon: 'Medal' },
  '安全生产许可证':         { token: 'var(--warning)',      value: 'oklch(0.72 0.15 72)',  icon: 'Lock' },
  '质量管理体系认证':       { token: 'var(--success)',      value: 'oklch(0.64 0.15 152)', icon: 'CircleCheck' },
  '环境管理体系认证':       { token: 'var(--water)',        value: 'oklch(0.5 0.12 175)',  icon: 'Sunny' },
  '职业健康安全管理体系认证':{ token: 'var(--danger)',       value: 'oklch(0.62 0.21 27)',  icon: 'User' },
}
function qTypeMeta(t: string) {
  const meta = qualTypeTokens[t]
  return meta || { token: 'var(--muted-foreground)', value: 'oklch(0.6 0.02 258)', icon: 'More' }
}

async function qCustomUpload(options: any) {
  const file = options.file as File
  if (file.size > 50*1024*1024) { ElMessage.error('文件不能超过50MB'); options.onError(new Error('FILE_TOO_LARGE')); return }
  qualUploading.value = true; qualUploadProgress.value = 0
  try { const res = await uploadFile(file,'qualification',(p)=>qualUploadProgress.value=p); qualForm.value.fileUrl=res.url; uploadedMeta.value=res; options.onSuccess(res); ElMessage.success('文件上传成功'); qMarkDirty() } catch(e:any){options.onError(e)} finally { qualUploading.value=false; qualUploadProgress.value=null }
}
function qFormatSize(b: number): string { if(b<1024)return `${b} B`; if(b<1024*1024)return `${(b/1024).toFixed(1)} KB`; return `${(b/1024/1024).toFixed(1)} MB` }
async function qHandleAdd() { if(!qualForm.value.type||!qualForm.value.name){ElMessage.warning('请填写资质类型和名称');return}; if(!uploadedMeta.value||!qualForm.value.fileUrl){ElMessage.warning('请先上传资质文件');return}; qualDialogLoading.value=true; try{await supplierStore.addQualification(qualForm.value);ElMessage.success('资质添加成功');qualDialogVisible.value=false;qualFormDirty.value=false}catch{ElMessage.error('添加失败')}finally{qualDialogLoading.value=false} }
async function qHandleDelete(id:string) { await ElMessageBox.confirm('确定要删除此资质材料吗？','提示',{type:'warning'}); try{await supplierStore.deleteQualification(id);ElMessage.success('已删除')}catch{ElMessage.error('删除失败')} }
function qStatusInfo(q:any) { if(!q.validTo)return{label:'长期有效',cls:'approved'}; const diff=(new Date(q.validTo).getTime()-Date.now())/86400000; if(diff<0)return{label:'已过期',cls:'rejected'}; if(diff<30)return{label:'即将过期',cls:'pending'}; return{label:'有效',cls:'approved'} }
function qExpiryPct(q:any): number { if(!q.validFrom||!q.validTo)return 100; const total=new Date(q.validTo).getTime()-new Date(q.validFrom).getTime(); const remaining=new Date(q.validTo).getTime()-Date.now(); return Math.max(0,Math.min(100,Math.round((remaining/total)*100))) }
function qExtractFileName(url:string):string { if(!url)return''; const m=url.match(/\/([^/]+\.\w{2,5})$/i); if(m)return m[1]; return '附件文件' }

const qHealth = computed(() => {
  const quals=supplierStore.qualifications; let v=0,ex=0,ed=0,lt=0; const now=Date.now()
  quals.forEach((q:any)=>{if(!q.validTo){lt++;return}; const diff=(new Date(q.validTo).getTime()-now)/86400000; if(diff<0)ed++; else if(diff<30)ex++; else v++})
  const score=quals.length>0?Math.round(((v+lt)/quals.length)*100):0
  return {total:quals.length,valid:v,expiring:ex,expired:ed,longTerm:lt,healthScore:score}
})
const qTone = computed(() => { const s=qHealth.value; if(s.expired>0)return{color:'var(--danger)',label:'有证照过期，请尽快更新'}; if(s.expiring>0)return{color:'var(--warning)',label:'有证照即将过期'}; return{color:'var(--success)',label:'所有证照状态良好'} })
const qRingDash = computed(() => { const r=2*Math.PI*34; const d=r*qHealth.value.healthScore/100; return`${d} ${r-d}` })

// ═══════════════════ 联系人 ═══════════════════
const contactsLoading = ref(false); const contactsErr = ref(false)
const ctDialogVisible = ref(false); const ctDialogLoading = ref(false)
const ctIsEdit = ref(false); const ctEditId = ref('')
const ctForm = ref({ name:'', phone:'', email:'', position:'', isPrimary:false })
const ctFormDirty = ref(false)
const ctGuard = createDialogLeaveGuard(ctFormDirty)
function ctMarkDirty() { ctFormDirty.value = true }
async function ctClosePanel() { await ctGuard(() => { ctDialogVisible.value = false; ctFormDirty.value = false }) }

function ctOpenAdd() { ctIsEdit.value=false; ctEditId.value=''; ctForm.value={name:'',phone:'',email:'',position:'',isPrimary:false}; ctFormDirty.value=false; ctDialogVisible.value=true }
function ctOpenEdit(c:any) { ctIsEdit.value=true; ctEditId.value=c.id; ctForm.value={name:c.name,phone:c.phone,email:c.email||'',position:c.position||'',isPrimary:c.isPrimary}; ctFormDirty.value=false; ctDialogVisible.value=true }
async function ctHandleSubmit() { if(!ctForm.value.name||!ctForm.value.phone){ElMessage.warning('请填写姓名和手机号');return}; if(!/^1[3-9]\d{9}$/.test(ctForm.value.phone)){ElMessage.warning('请输入正确的11位手机号');return}; ctDialogLoading.value=true; try{if(ctIsEdit.value){await supplierStore.updateContact(ctEditId.value,ctForm.value);ElMessage.success('联系人更新成功')}else{await supplierStore.addContact(ctForm.value);ElMessage.success('联系人添加成功')}; ctDialogVisible.value=false;ctFormDirty.value=false}catch{ElMessage.error(ctIsEdit.value?'更新失败':'添加失败')}finally{ctDialogLoading.value=false} }
async function ctHandleDelete(id:string) { await ElMessageBox.confirm('确定要删除此联系人吗？','提示',{type:'warning'}); try{await supplierStore.deleteContact(id);ElMessage.success('已删除')}catch{ElMessage.error('删除失败')} }

function onQualAttach(e:Event){ const f=(e.target as HTMLInputElement).files?.[0]; if(!f)return; if(f.size>50*1024*1024){ElMessage.error('文件不能超过50MB');return}; ElMessage.warning('附件上传将在后续版本支持') }

// ═══════ 变更申请弹窗 ═══════
const crDlg = ref(false); const crMode = ref<'basic'|'quals'|'contacts'>('basic')
const crSub = ref(false); const crProfileLoaded = ref(false)
const crOrigQualCount = ref(0); const crOrigContactCount = ref(0)
const CR_FIELDS = ['name','enterpriseType','legalPerson','registeredAddress','businessScope'] as const
const crForm = reactive<Record<string,string>>({})
const crOrig = reactive<Record<string,string>>({})
const crReason = ref('')
// 业务标签（独立于普通字段，数组形式）
const crTags = ref<string[]>([])
const crTagsDeleted = ref<string[]>([])
const crTagsAdded = ref<string[]>([])
function crAddTag() { if (crTags.value.length < 8) crTags.value.push('') }
function crRemoveTag(i: number) { if (crTags.value.length > 2) crTags.value.splice(i, 1) }
const crHasTagsChanges = computed(() => {
  const filled = crTags.value.filter(t => t.trim())
  const orig = (supplierStore.profile?.tags as string[]) || []
  if (filled.length !== orig.length) return true
  return filled.some((t, i) => t !== orig[i])
})
const crFieldChanged = computed(()=> CR_FIELDS.filter(k=> (crForm[k]??'')!==(crOrig[k]??'') && (crForm[k]??'').trim()!==''))
const crHasBasicChanges = computed(()=> crFieldChanged.value.length>0 || crHasTagsChanges.value)
const crHasQualChanges = computed(()=> supplierStore.qualifications.length !== crOrigQualCount.value)
const crHasContactChanges = computed(()=> supplierStore.contacts.length !== crOrigContactCount.value)
const crHasChanges = computed(() => crMode.value==='basic' ? crHasBasicChanges.value : crMode.value==='quals' ? crHasQualChanges.value : crHasContactChanges.value)
const crFieldLabels: Record<string,string> = {name:'企业名称',enterpriseType:'企业类型',legalPerson:'法定代表人',registeredAddress:'注册地址',businessScope:'经营范围',tags:'业务标签'}
async function openCrDlg(){
  crDlg.value=true; crMode.value='basic'
  if(!crProfileLoaded.value){ try{await supplierStore.fetchProfile()}catch{ElMessage.error('加载企业资料失败');return}; crProfileLoaded.value=true }
  const p=supplierStore.profile; if(!p)return
  CR_FIELDS.forEach(k=>{const v=(p[k] as string)??''; crForm[k]=v; crOrig[k]=v})
  crReason.value=''
  const ptags = (p as any).tags
  crTags.value = (Array.isArray(ptags) && ptags.length >= 2) ? [...ptags] : ['', '']
  crOrigQualCount.value=supplierStore.qualifications.length; crOrigContactCount.value=supplierStore.contacts.length
  crQualSnapshotDone=false; crContactSnapshotDone=false
}
function crReset(k:string){crForm[k]=crOrig[k]}
function crResetAll(){CR_FIELDS.forEach(k=>crForm[k]=crOrig[k]);crReason.value=''}
async function crSubmit(){
  if(!crHasChanges.value){ElMessage.warning('请至少修改一项资料');return}
  if(crMode.value==='basic'){
    if(!crReason.value.trim()){ElMessage.warning('请填写变更原因');return}
    // P0-5：用户输入拼进 dangerouslyUseHTMLString 弹窗，须 HTML 转义防存储型 XSS（与 ChangeRequest.vue 的 esc 一致）。
    const esc=(s:any)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    let ls=crFieldChanged.value.map(k=>`<div style="margin:6px 0"><b>${crFieldLabels[k]}</b><br/><span style="color:#94a3b8;text-decoration:line-through">${esc(crOrig[k])||'（空）'}</span> → <span style="color:#059669;font-weight:600">${esc(crForm[k])}</span></div>`).join('')
    if (crHasTagsChanges.value) ls+=`<div style="margin:6px 0"><b>业务标签</b><br/><span style="color:#059669;font-weight:600">${esc(crTags.value.filter(t=>t.trim()).join('、'))}</span></div>`
    const changeCount = crFieldChanged.value.length + (crHasTagsChanges.value ? 1 : 0)
    try{await ElMessageBox.confirm(`<div style="font-size:13px;line-height:1.6">将提交 <b>${changeCount}</b> 项变更：${ls}<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);color:#64748b">变更原因：${esc(crReason.value)}</div></div>`,'确认提交变更',{confirmButtonText:'确认提交',cancelButtonText:'取消',type:'warning',dangerouslyUseHTMLString:true})}catch{return}
    crSub.value=true; let ok=0,fail=0
    for(const k of crFieldChanged.value){ try{await supplierStore.createChangeRequest({fieldName:k,fieldLabel:crFieldLabels[k],oldValue:crOrig[k]||'',newValue:crForm[k],reason:crReason.value.trim()});ok++}catch{fail++} }
    if (crHasTagsChanges.value) {
      const filled = crTags.value.filter(t => t.trim())
      try { await supplierStore.createChangeRequest({ fieldName: 'tags', fieldLabel: '业务标签', oldValue: JSON.stringify((supplierStore.profile as any)?.tags || []), newValue: JSON.stringify(filled), reason: crReason.value.trim() }); ok++ } catch { fail++ }
    }
    crSub.value=false
    if(ok>0&&fail===0){ElMessage.success(`已提交 ${ok} 项变更申请`);crDlg.value=false}
    else if(ok>0){ElMessage.warning(`部分成功：${ok} 项成功`);crDlg.value=false}
    else{ElMessage.error('提交失败')}
  } else {
    ElMessage.success('变更已生效'); crDlg.value=false
  }
}
let crQualSnapshotDone=false; let crContactSnapshotDone=false
function crSwitch(m:typeof crMode.value){ crMode.value=m; if(m==='quals' && !crQualSnapshotDone){ qualsLoading.value=true;supplierStore.fetchQualifications().catch(()=>{}).finally(()=>{qualsLoading.value=false; crOrigQualCount.value=supplierStore.qualifications.length; crQualSnapshotDone=true}) } if(m==='contacts' && !crContactSnapshotDone){ contactsLoading.value=true;supplierStore.fetchContacts().catch(()=>{}).finally(()=>{contactsLoading.value=false; crOrigContactCount.value=supplierStore.contacts.length; crContactSnapshotDone=true}) } }

onMounted(async () => {
  try { await supplierStore.fetchProfile() } catch { error.value = true } finally { loading.value = false }
})
async function retryLoad() { error.value=false; loading.value=true; try{await supplierStore.fetchProfile()}catch{error.value=true}finally{loading.value=false} }
async function loadQualifications() { if(supplierStore.qualifications.length>0)return; qualsLoading.value=true; try{await supplierStore.fetchQualifications()}catch{qualsErr.value=true}finally{qualsLoading.value=false} }
async function loadContacts() { if(supplierStore.contacts.length>0)return; contactsLoading.value=true; try{await supplierStore.fetchContacts()}catch{contactsErr.value=true}finally{contactsLoading.value=false} }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <SpPageHero :icon="Building2" title="企业信息" sub="企业抬头、详细信息、资质证照与联系人管理。">
      <template #actions>
        <el-button type="primary" @click="openCrDlg">
              <el-icon><EditPen /></el-icon>申请资料变更
            </el-button>
      </template>
    </SpPageHero>

    <!-- ═══ Tab bar ═══ -->
    <div class="neu-tab-bar profile-tabs">
      <button class="neu-tab" :class="{ active: activeTab==='info', 'is-active': activeTab==='info' }" @click="activeTab='info'">企业信息</button>
      <button class="neu-tab" :class="{ active: activeTab==='quals', 'is-active': activeTab==='quals' }" @click="activeTab='quals'; loadQualifications()">资质与证照</button>
      <button class="neu-tab" :class="{ active: activeTab==='contacts', 'is-active': activeTab==='contacts' }" @click="activeTab='contacts'; loadContacts()">联系人</button>
    </div>

    <!-- ═══ Error ═══ -->
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else-if="supplierStore.profile">
      <!-- ══════════ 企业信息 Tab ══════════ -->
      <div v-if="activeTab==='info'" class="detail-card">
        <div class="company-identity">
          <div class="company-avatar">{{ supplierStore.profile.name?.charAt(0) }}</div>
          <div class="company-title"><h2>{{ supplierStore.profile.name }}</h2><div class="company-subline"><span class="company-credit-code">{{ supplierStore.profile.creditCode }}</span> <el-button link type="primary" style="padding:0;font-size:18px" @click="copyCreditCode" title="复制信用代码"><el-icon><CopyDocument /></el-icon></el-button><span class="sp-status" :class="{pending:supplierStore.profile.status==='PENDING',approved:supplierStore.profile.status==='APPROVED',rejected:supplierStore.profile.status==='REJECTED'||supplierStore.profile.status==='BLACKLIST',returned:supplierStore.profile.status==='RETURNED',disabled:supplierStore.profile.status==='DISABLED'}">{{ statusText[supplierStore.profile.status]||supplierStore.profile.status }}</span></div></div>
        </div>
        <div class="info-grid">
          <div v-for="row in profileRows" :key="row.label" class="info-item" :class="{wide:row.wide}"><span>{{ row.label }}</span><strong>{{ row.value||'-' }}</strong></div>
        </div>
        <div class="info-tags">
          <span class="info-tags-label">业务标签</span>
          <div v-if="profileTags.length > 0" class="info-tags-list">
            <span v-for="t in profileTags" :key="t" class="info-tag-chip">{{ t }}</span>
          </div>
          <span v-else class="info-tags-empty">暂无业务标签，可点「申请资料变更」补充</span>
        </div>
        <div v-if="supplierStore.profile.rejectReason" class="reason-card error"><strong>审核不通过原因</strong>{{ supplierStore.profile.rejectReason }}</div>
        <div v-if="supplierStore.profile.returnReason" class="reason-card warning"><strong>退回补正原因</strong>{{ supplierStore.profile.returnReason }}</div>
      </div>

      <!-- ══════════ 资质与证照 Tab ══════════ -->
      <div v-if="activeTab==='quals'" v-loading="qualsLoading">
        <div v-if="qualsErr" class="sp-error-block"><div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div><div class="sp-error-text">资质数据加载失败</div><el-button type="primary" @click="loadQualifications">重新加载</el-button></div>
        <template v-else>
          <div v-if="qHealth.total > 0" class="qual-health-dashboard">
            <div class="qual-health-ring"><svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--hairline)" stroke-width="6"/><circle cx="40" cy="40" r="34" fill="none" :stroke="qTone.color" stroke-width="6" stroke-linecap="round" :stroke-dasharray="qRingDash" transform="rotate(-90 40 40)" class="qual-health-ring-arc"/></svg><span class="qual-health-score">{{ qHealth.healthScore }}%</span></div>
            <div class="qual-health-body">
              <div class="qual-health-chips"><span class="qual-health-chip valid"><span class="chip-dot"/> {{ qHealth.valid }} 有效</span><span class="qual-health-chip long-term"><span class="chip-dot"/> {{ qHealth.longTerm }} 长期</span><span class="qual-health-chip expiring"><span class="chip-dot"/> {{ qHealth.expiring }} 即将过期</span><span class="qual-health-chip expired"><span class="chip-dot"/> {{ qHealth.expired }} 已过期</span></div>
              <div class="qual-health-message" :style="{'--c':qTone.color} as any"><span>{{ qTone.label }}</span></div>
            </div>
          </div>
          <el-row v-if="supplierStore.qualifications.length>0" :gutter="16">
            <el-col :xs="24" :sm="12" :lg="8" v-for="q in supplierStore.qualifications" :key="q.id">
              <article class="qual-card">
                <div class="qual-card-head"><div class="qual-card-head-left" :style="{'--c':qTypeMeta(q.type).value} as any"><span class="qual-type-dot"><el-icon :size="12"><component :is="qTypeMeta(q.type).icon"/></el-icon></span><span class="qual-type-label">{{ q.type }}</span></div><div class="qual-card-head-right"><span class="qual-status-badge" :class="qStatusInfo(q).cls">{{ qStatusInfo(q).label }}</span><el-button class="qual-delete-btn" text size="small" @click="qHandleDelete(q.id)" title="删除"><el-icon :size="14"><Delete /></el-icon></el-button></div></div>
                <h3 class="qual-name">{{ q.name }}</h3>
                <div class="qual-timeline" v-if="q.validFrom"><div class="qual-timeline-bar"><div class="qual-timeline-fill" :style="{width:q.validTo?qExpiryPct(q)+'%':'100%', '--c':qTypeMeta(q.type).value, opacity: 0.35+(qExpiryPct(q)/100)*0.65}"/></div><div class="qual-timeline-labels"><span class="qual-timeline-date">{{ dayjs(q.validFrom).format('YYYY-MM-DD') }}</span><span class="qual-timeline-date" v-if="q.validTo">{{ dayjs(q.validTo).format('YYYY-MM-DD') }}</span><span class="qual-timeline-date qual-timeline-date--inf" v-else>长期</span></div></div>
                <div v-else class="qual-timeline qual-timeline--longterm"><span class="qual-timeline-label">长期有效</span></div>
                <div class="qual-file-row" v-if="q.fileUrl" @click="window.open(q.fileUrl,'_blank','noopener')"><span class="qual-file-icon"><el-icon :size="16"><Document /></el-icon></span><span class="qual-file-name">{{ qExtractFileName(q.fileUrl) }}</span><span class="qual-file-cta">查看</span></div>
                <div class="qual-file-row qual-file-row--empty" v-else><span class="qual-file-icon qual-file-icon--muted"><el-icon :size="14"><Document /></el-icon></span><span class="qual-file-name qual-file-name--muted">暂未上传附件</span></div>
              </article>
            </el-col>
          </el-row>
          <div v-else class="qual-empty"><div class="qual-empty-icon"><el-icon :size="28"><Folder /></el-icon></div><p class="qual-empty-title">暂无资质材料</p><p class="qual-empty-desc">点击上方「添加资质」按钮，上传企业资质证照</p></div>
        </template>
      </div>

      <!-- ══════════ 联系人 Tab ══════════ -->
      <div v-if="activeTab==='contacts'" v-loading="contactsLoading">
        <div v-if="contactsErr" class="sp-error-block"><div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div><div class="sp-error-text">联系人数据加载失败</div><el-button type="primary" @click="loadContacts">重新加载</el-button></div>
        <template v-else>
          <div class="quals-actions"><el-button type="primary" @click="ctOpenAdd"><el-icon><Plus /></el-icon>添加联系人</el-button></div>
          <div v-if="supplierStore.contacts.length>0" class="neu-table-card ct-table-wrap">
            <el-table class="neu-table" :data="supplierStore.contacts" stripe>
              <el-table-column label="姓名" prop="name" width="160"><template #default="{row}"><div class="contact-name-cell"><el-avatar :size="32" class="contact-avatar">{{ row.name?.charAt(0) }}</el-avatar><span class="contact-name">{{ row.name }}</span></div></template></el-table-column>
              <el-table-column label="手机号" prop="phone" width="160" />
              <el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column>
              <el-table-column label="职位" prop="position" width="120"><template #default="{row}">{{ row.position||'-' }}</template></el-table-column>
              <el-table-column label="主要联系人" width="120" align="center"><template #default="{row}"><el-tag :type="row.isPrimary?'primary':'info'" size="small" effect="plain">{{ row.isPrimary?'主要':'普通' }}</el-tag></template></el-table-column>
              <el-table-column label="操作" width="160" align="center"><template #default="{row}"><button class="neu-btn-xs" @click="ctOpenEdit(row)">编辑</button><button class="neu-btn-xs is-danger" @click="ctHandleDelete(row.id)">删除</button></template></el-table-column>
            </el-table>
          </div>
          <div v-else class="detail-card ct-empty"><div class="ct-empty-icon"><el-icon :size="28"><Phone /></el-icon></div><p class="ct-empty-title">暂无联系人</p><p class="ct-empty-desc">请添加企业联系人信息</p></div>
        </template>
      </div>
    </template>

    <!-- ═══ 资质弹窗 (Teleport) ═══ -->
    <Teleport to="body">
      <Transition name="add-panel">
        <div v-if="qualDialogVisible" class="add-overlay" @click.self="qClosePanel">
          <div class="add-panel">
            <div class="add-panel-head"><div class="add-panel-head-left"><div class="add-panel-head-icon"><el-icon :size="20"><Medal /></el-icon></div><div><h2 class="add-panel-title">添加资质材料</h2><p class="add-panel-sub">上传证照文件并填写有效期信息</p></div></div><button class="add-panel-close" @click="qClosePanel"><el-icon :size="18"><Close /></el-icon></button></div>
            <div class="add-panel-body">
              <div class="add-panel-sec"><div class="add-panel-sec-label"><span class="add-panel-sec-dot"/>基本信息</div><div class="add-panel-row"><div class="add-panel-field"><label class="add-panel-label">资质类型 <i>*</i></label><select class="add-panel-select" v-model="qualForm.type" @change="qMarkDirty"><option value="" disabled>请选择资质类型</option><option v-for="t in qualTypes" :key="t" :value="t">{{ t }}</option></select><span class="add-panel-select-arrow"><el-icon :size="12"><ArrowDown /></el-icon></span></div><div class="add-panel-field"><label class="add-panel-label">资质名称 <i>*</i></label><div class="add-panel-input-wrap"><input class="add-panel-input" v-model="qualForm.name" placeholder="如：企业法人营业执照" maxlength="50" @input="qMarkDirty"/><span v-if="qualForm.name" class="add-panel-count">{{ qualForm.name.length }}/50</span></div></div></div></div>
              <div class="add-panel-sec"><div class="add-panel-sec-label"><span class="add-panel-sec-dot"/>有效期</div><div class="add-panel-row"><div class="add-panel-field"><label class="add-panel-label add-panel-label--opt">有效期起</label><input class="add-panel-input" type="date" v-model="qualForm.validFrom" @change="qMarkDirty"/></div><div class="add-panel-field"><label class="add-panel-label add-panel-label--opt">有效期止</label><input class="add-panel-input" type="date" v-model="qualForm.validTo" @change="qMarkDirty" placeholder="不填为长期有效"/></div></div></div>
              <div class="add-panel-sec"><div class="add-panel-sec-label"><span class="add-panel-sec-dot"/>资质文件 <i>*</i></div><div class="add-panel-upload" :class="{'is-done':uploadedMeta,'is-uploading':qualUploading}"><template v-if="!uploadedMeta"><div class="add-panel-upload-drop"><span class="add-panel-upload-drop-icon"><el-icon :size="28"><UploadFilled /></el-icon></span><p class="add-panel-upload-drop-text">拖拽文件到此处，或点击下方按钮</p><p class="add-panel-upload-drop-hint">支持 PDF、图片、Office、ZIP 格式，不超过 50 MB</p><el-upload :show-file-list="false" :http-request="qCustomUpload" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"><button type="button" class="add-panel-upload-btn" :disabled="qualUploading"><el-icon :size="14"><UploadFilled /></el-icon><span>{{ qualUploading ? '上传中…' : '选择文件' }}</span></button></el-upload></div></template><template v-else><div class="add-panel-upload-file"><span class="add-panel-upload-file-icon"><el-icon :size="18"><Document /></el-icon></span><div class="add-panel-upload-file-info"><span class="add-panel-upload-file-name">{{ uploadedMeta.originalName }}</span><span class="add-panel-upload-file-meta">{{ qFormatSize(uploadedMeta.size) }}</span></div><el-upload :show-file-list="false" :http-request="qCustomUpload" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"><button type="button" class="add-panel-upload-replace">替换文件</button></el-upload></div></template><Transition name="add-fade"><div v-if="qualUploadProgress!==null" class="add-panel-upload-progress"><div class="add-panel-upload-progress-bar" :style="{width:qualUploadProgress+'%'}"/></div></Transition></div></div>
            </div>
            <div class="add-panel-foot"><span class="add-panel-hint" v-if="!uploadedMeta">请上传资质文件</span><span class="add-panel-hint ready" v-else>已准备好提交</span><div class="add-panel-foot-actions"><button class="add-panel-btn-cancel" @click="qClosePanel">取消</button><button class="add-panel-btn-submit" :class="{ready:uploadedMeta&&!qualDialogLoading}" :disabled="!uploadedMeta||qualDialogLoading" @click="qHandleAdd"><span v-if="qualDialogLoading">提交中…</span><template v-else><el-icon :size="15"><ArrowRight /></el-icon><span>确认添加</span></template></button></div></div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 联系人弹窗 (Teleport) ═══ -->
    <Teleport to="body">
      <Transition name="ct-panel">
        <div v-if="ctDialogVisible" class="ct-overlay" @click.self="ctClosePanel">
          <div class="ct-panel">
            <div class="ct-panel-head"><div class="ct-panel-head-left"><div class="ct-panel-head-icon"><el-icon :size="20"><Phone /></el-icon></div><div><h2 class="ct-panel-title">{{ ctIsEdit?'编辑联系人':'添加联系人' }}</h2><p class="ct-panel-sub">{{ ctIsEdit?'修改联系人信息后保存':'填写企业联系人姓名与联系方式' }}</p></div></div><button class="ct-panel-close" @click="ctClosePanel"><el-icon :size="18"><Close /></el-icon></button></div>
            <div class="ct-panel-body">
              <div class="ct-panel-sec"><div class="ct-panel-sec-label"><span class="ct-panel-sec-dot"/>基本信息</div><div class="ct-panel-row"><div class="ct-panel-field"><label class="ct-panel-label">姓名 <i>*</i></label><input class="ct-panel-input" v-model="ctForm.name" placeholder="请输入姓名" maxlength="20" @input="ctMarkDirty"/></div><div class="ct-panel-field"><label class="ct-panel-label">手机号 <i>*</i></label><input class="ct-panel-input" v-model="ctForm.phone" placeholder="请输入11位手机号" maxlength="11" @input="ctMarkDirty"/></div></div><div class="ct-panel-row" style="margin-top:14px"><div class="ct-panel-field"><label class="ct-panel-label ct-panel-label--opt">邮箱</label><input class="ct-panel-input" v-model="ctForm.email" placeholder="请输入邮箱（选填）" @input="ctMarkDirty"/></div><div class="ct-panel-field"><label class="ct-panel-label ct-panel-label--opt">职位/职务</label><input class="ct-panel-input" v-model="ctForm.position" placeholder="请输入职位/职务" maxlength="50" @input="ctMarkDirty"/></div></div><div class="ct-panel-row" style="margin-top:14px"><div class="ct-panel-field ct-panel-field--toggle"><label class="ct-panel-label ct-panel-label--opt">主要联系人</label><button type="button" class="ct-toggle" :class="{active:ctForm.isPrimary}" @click="ctForm.isPrimary=!ctForm.isPrimary;ctMarkDirty()"><span class="ct-toggle-knob"/></button></div></div></div>
            </div>
            <div class="ct-panel-foot"><span class="ct-panel-hint" v-if="!ctForm.name&&!ctForm.phone">请填写联系人信息</span><span class="ct-panel-hint ready" v-else>信息已就绪</span><div class="ct-panel-foot-actions"><button class="ct-panel-btn-cancel" @click="ctClosePanel">取消</button><button class="ct-panel-btn-submit" :class="{ready:ctForm.name&&ctForm.phone&&!ctDialogLoading}" :disabled="!ctForm.name||!ctForm.phone||ctDialogLoading" @click="ctHandleSubmit"><span v-if="ctDialogLoading">保存中…</span><template v-else><el-icon :size="15"><ArrowRight /></el-icon><span>{{ ctIsEdit?'保存':'确认添加' }}</span></template></button></div></div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 变更申请弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="dlg"><div v-if="crDlg" class="crp-overlay" @click.self="crDlg=false"><div class="crp-panel">
        <div class="crp-head"><div class="crp-head-l"><div class="crp-head-i"><el-icon :size="20"><EditPen /></el-icon></div><div><h2 class="crp-title">申请资料变更</h2><p class="crp-sub">选择变更类别，编辑对应内容后提交</p></div></div><button class="crp-x" @click="crDlg=false"><el-icon :size="18"><Close /></el-icon></button></div>
        <div class="crp-body">
          <div class="crp-bar">
            <button class="neu-tab" :class="{active:crMode==='basic','is-active':crMode==='basic'}" @click="crSwitch('basic')">基本资料</button>
            <button class="neu-tab" :class="{active:crMode==='quals','is-active':crMode==='quals'}" @click="crSwitch('quals')">资质与证照</button>
            <button class="neu-tab" :class="{active:crMode==='contacts','is-active':crMode==='contacts'}" @click="crSwitch('contacts')">联系人</button>
          </div>
          <div v-if="crMode==='basic'">
            <div v-if="crHasChanges" class="crp-cnt"><span class="crp-cnt-n">{{ crFieldChanged.length + (crHasTagsChanges ? 1 : 0) }}</span><span>项修改</span></div>
            <div class="crp-fs"><div v-for="k in CR_FIELDS" :key="k" class="crp-f" :class="{dirty:crForm[k]!==crOrig[k]}">
              <div class="crp-fh"><label>{{ crFieldLabels[k] }}</label><span v-if="crForm[k]!==crOrig[k]" class="crp-tag">已修改</span></div>
              <div v-if="crForm[k]!==crOrig[k] && crOrig[k]" class="crp-ov"><span class="crp-ovl">原值</span><span class="crp-ovv">{{ crOrig[k] }}</span><button class="neu-btn-xs" @click="crReset(k)">还原</button></div>
              <textarea v-if="k==='registeredAddress'||k==='businessScope'" class="neu-input" v-model="crForm[k]" :rows="k==='businessScope'?3:2" />
              <input v-else class="neu-input" v-model="crForm[k]" />
            </div></div>
            <!-- 业务标签 -->
            <div class="crp-f" style="margin-bottom:17px">
              <div class="crp-fh">
                <label>业务标签</label>
                <span class="crp-n">{{ crTags.filter(t=>t.trim()).length }}/8</span>
                <button type="button" class="neu-btn-xs" :disabled="crTags.length >= 8" @click="crAddTag" style="margin-left:auto">+ 添加</button>
              </div>
              <div v-for="(t, i) in crTags" :key="'crtag'+i" style="display:flex;align-items:center;gap:8px;margin-top:6px">
                <span class="crp-fh" style="min-width:24px;font-size:12px;color:var(--muted-foreground);font-weight:700">{{ i+1 }}.</span>
                <input class="neu-input" v-model="crTags[i]" :placeholder="i===0?'如：办公用品':i===1?'如：钻机销售':'标签'+(i+1)" maxlength="20" style="flex:1" :class="{ dirty: crTags[i].trim() && (!(supplierStore.profile as any)?.tags?.[i] || crTags[i] !== (supplierStore.profile as any).tags[i]) }" />
                <button v-if="crTags.length > 2" class="neu-btn-xs is-danger" @click="crRemoveTag(i)">删除</button>
              </div>
            </div>
            <div class="crp-f"><label>变更原因</label><span class="crp-n">{{ crReason.length }}/200</span><textarea class="neu-input" v-model="crReason" :rows="3" maxlength="200" placeholder="请说明本次变更的原因" /></div>
          </div>
          <div v-if="crMode==='quals'" v-loading="qualsLoading">
            <div style="margin-bottom:12px"><el-button type="primary" @click="qualForm={type:'',name:'',fileUrl:'',validFrom:'',validTo:''};uploadedMeta=null;qualFormDirty=false;qualDialogVisible=true"><el-icon><Plus /></el-icon>添加资质</el-button></div>
            <el-row v-if="supplierStore.qualifications.length>0" :gutter="12"><el-col :xs="24" :sm="12" v-for="q in supplierStore.qualifications" :key="q.id"><article class="qc"><div class="qc-h"><div class="qc-hl" :style="{'--c':qTypeMeta(q.type).value} as any"><span class="qc-d"><el-icon :size="12"><component :is="qTypeMeta(q.type).icon"/></el-icon></span><span class="qc-t">{{ q.type }}</span></div><div class="qc-hr"><span class="qc-st" :class="qStatusInfo(q).cls">{{ qStatusInfo(q).label }}</span><el-button class="qc-del" text size="small" @click="qHandleDelete(q.id)" title="删除"><el-icon :size="14"><Delete /></el-icon></el-button></div></div><h3 class="qc-nm">{{ q.name }}</h3><div class="qc-tl" v-if="q.validFrom"><div class="qc-tb"><div class="qc-tf" :style="{width:q.validTo?qExpiryPct(q)+'%':'100%','--c':qTypeMeta(q.type).value}"/></div><div class="qc-td"><span>{{ dayjs(q.validFrom).format('YYYY-MM-DD') }}</span><span v-if="q.validTo">{{ dayjs(q.validTo).format('YYYY-MM-DD') }}</span><span v-else>长期</span></div></div><div v-else class="qc-tl qc-tl--lt">长期有效</div><div class="qc-fr" v-if="q.fileUrl" @click="window.open(q.fileUrl,'_blank','noopener')"><span class="qc-fi"><el-icon :size="16"><Document /></el-icon></span><span class="qc-fn">{{ qExtractFileName(q.fileUrl) }}</span><span class="qc-fa">查看</span></div><label class="neu-btn-xs qc-atch"><input type="file" hidden @change="onQualAttach"/>添加附件</label></article></el-col></el-row>
            <div v-else class="qc-e"><el-icon :size="28"><Folder /></el-icon><p>暂无资质材料</p></div>
          </div>
          <div v-if="crMode==='contacts'" v-loading="contactsLoading">
            <div style="margin-bottom:12px"><el-button type="primary" @click="ctOpenAdd"><el-icon><Plus /></el-icon>添加联系人</el-button></div>
            <div v-if="supplierStore.contacts.length>0" class="neu-table-card"><el-table class="neu-table" :data="supplierStore.contacts" stripe><el-table-column label="姓名" prop="name" width="120"><template #default="{row}"><div class="crcell"><el-avatar :size="28" class="crav">{{ row.name?.charAt(0) }}</el-avatar><span class="crnm">{{ row.name }}</span></div></template></el-table-column><el-table-column label="手机号" prop="phone" width="140"/><el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column><el-table-column label="职位" prop="position" width="100"><template #default="{row}">{{ row.position||'-' }}</template></el-table-column><el-table-column label="操作" width="120" align="center"><template #default="{row}"><button class="neu-btn-xs" @click="ctOpenEdit(row)">编辑</button><button class="neu-btn-xs is-danger" @click="ctHandleDelete(row.id)">删除</button></template></el-table-column></el-table></div>
            <div v-else class="qc-e"><el-icon :size="28"><Phone /></el-icon><p>暂无联系人</p></div>
          </div>
        </div>
        <div class="crp-ft"><span class="crp-ft-h" v-if="!crHasChanges">修改内容后即可提交</span><span class="crp-ft-h ok" v-else-if="crMode==='basic' && !crReason.trim()">请填写变更原因</span><span class="crp-ft-h ok" v-else-if="crMode==='basic'">已修改 {{ crFieldChanged.length }} 项</span><span class="crp-ft-h ok" v-else>检测到变更</span><span v-if="crMode!=='basic'" style="font-size:11px;color:var(--warning);font-weight:600;margin-left:auto">⚠ 资质与联系人修改保存后立即生效（不走审核）</span><div class="neu-btn-group"><button class="neu-btn-soft" @click="crDlg=false">取消</button><button class="neu-btn-primary" :disabled="!crHasChanges || (crMode==='basic' && !crReason.trim()) || crSub" @click="crSubmit">{{ crSub?'提交中…':'申请变更' }}</button></div></div>
      </div></div></Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══ Tabs ═══ */
.profile-tabs { margin-top: 16px; }

/* ═══ Detail surface ═══ */
.detail-card { position: relative; padding: 28px; margin-top: 16px; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.company-identity { display: flex; align-items: center; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid var(--hairline); }
.company-avatar { width: 72px; height: 72px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: var(--brand); color: #fff; font-size: 32px; font-weight: 900; box-shadow: 4px 4px 10px oklch(0.4 0.1 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.25); }
.company-title h2 { margin: 0; color: var(--foreground); font-size: 24px; font-weight: 900; letter-spacing: -0.02em; }
.company-subline { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; color: var(--muted-foreground); }
.company-credit-code { font-family: 'SF Mono','JetBrains Mono',monospace; font-size: 13px; font-variant-numeric: tabular-nums; }
.info-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 24px; }
.info-item { padding: 16px 18px; border-radius: 12px; background: oklch(0.985 0.005 258); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.85), 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.10), -2px -2px 5px oklch(1 0 0 / 0.9); }
.info-item.wide { grid-column: 1/-1; }
.info-item span { display: block; color: var(--muted-foreground); font-size: 12px; }
.info-item strong { display: block; margin-top: 6px; color: var(--foreground); font-size: 14px; line-height: 1.6; }
.info-tags { margin-top: 18px; padding: 14px 18px; border-radius: 12px; background: oklch(0.985 0.005 258); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.85), 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.10), -2px -2px 5px oklch(1 0 0 / 0.9); }
.info-tags-label { display: block; color: var(--muted-foreground); font-size: 12px; margin-bottom: 10px; }
.info-tags-list { display: flex; flex-wrap: wrap; gap: 10px; }
/* 高级感业务标签：oklch 渐变填充 + 顶缘内高光 + 菱形品牌标记符，不用 neumorphic 双影（标签属文字级小元素） */
.info-tag-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 12px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.015em;
  color: var(--brand-deep);
  background: linear-gradient(140deg,
    color-mix(in oklab, var(--brand) 15%, oklch(1 0 0)) 0%,
    color-mix(in oklab, var(--brand) 6%, oklch(1 0 0)) 100%);
  border: 1px solid color-mix(in oklab, var(--brand) 24%, transparent);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    0 1px 3px color-mix(in oklab, var(--brand) 12%, transparent);
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.28s ease;
}
.info-tag-chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 2px;
  transform: rotate(45deg);
  background: linear-gradient(140deg, var(--brand), var(--brand-deep));
  box-shadow: 0 0 0 2.5px color-mix(in oklab, var(--brand) 16%, transparent);
  flex-shrink: 0;
}
.info-tag-chip:hover {
  transform: translateY(-1.5px);
  border-color: color-mix(in oklab, var(--brand) 38%, transparent);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.85),
    0 7px 16px color-mix(in oklab, var(--brand) 20%, transparent);
}
.info-tags-empty { color: var(--muted-foreground); font-size: 13px; }
.reason-card { margin-top: 16px; padding: 14px 16px; border-radius: 12px; }
.reason-card strong { margin-right: 8px; }
.reason-card.error { color: var(--danger); background: color-mix(in oklab, var(--danger) 8%, transparent); }
.reason-card.warning { color: var(--warning); background: color-mix(in oklab, var(--warning) 10%, transparent); }

/* ═══ Actions bar (shared by quals + contacts) ═══ */
.quals-actions { margin-top: 14px; margin-bottom: 14px; }

/* ═══ Contacts table ═══ */
.ct-table-wrap { margin-top: 0; }
.contact-name-cell { display: flex; align-items: center; gap: 10px; }
.contact-avatar { background: var(--brand); font-size: 13px; }
.contact-name { font-weight: 700; font-size: 14px; color: var(--foreground); }
.ct-empty { text-align: center; padding: 64px 24px; }
.ct-empty-icon { color: var(--muted-foreground); margin-bottom: 8px; }
.ct-empty-title { margin: 12px 0 4px; font-size: 15px; font-weight: 700; color: var(--muted-foreground); }
.ct-empty-desc { margin: 0; font-size: 13px; color: var(--muted-foreground); }

/* ═══ Qual cards — inline, same as OG qualifications ═══ */
.qual-card { position: relative; display: flex; flex-direction: column; padding: 16px 18px; margin-bottom: 16px; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); transition: transform .15s ease, box-shadow .15s ease; }
.qual-card:hover { transform: translateY(-1px); box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.qual-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qual-card-head-left { display: flex; align-items: center; gap: 7px; min-width: 0; }
.qual-type-dot { width: 22px; height: 22px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: var(--c, var(--muted-foreground)); background: color-mix(in oklab, var(--c, #94a3b8) 12%, transparent); flex-shrink: 0; font-size: 12px; }
.qual-type-label { font-size: 12px; font-weight: 700; letter-spacing: .01em; color: var(--c, var(--muted-foreground)); }
.qual-card-head-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.qual-status-badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .02em; }
.qual-status-badge.approved { background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.qual-status-badge.pending  { background: color-mix(in oklab, var(--warning) 12%, transparent); color: var(--warning); }
.qual-status-badge.rejected { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
.qual-delete-btn { color: var(--muted-foreground); padding: 2px; opacity: 0; transition: opacity .15s ease, color .15s ease; }
.qual-card:hover .qual-delete-btn { opacity: 1; }
.qual-delete-btn:hover { color: var(--danger) !important; }
.qual-name { margin: 10px 0 12px 0; font-size: 15px; font-weight: 700; line-height: 1.45; color: var(--foreground); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qual-timeline { margin-bottom: 12px; }
.qual-timeline-bar { height: 4px; background: var(--hairline); border-radius: 2px; overflow: hidden; }
.qual-timeline-fill { height: 100%; border-radius: 2px; transition: width .8s ease; min-width: 4px; background: var(--c, var(--brand)); }
.qual-timeline-labels { display: flex; justify-content: space-between; margin-top: 5px; }
.qual-timeline-date { font-size: 10.5px; font-weight: 600; font-family: monospace; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.qual-timeline-date--inf { color: var(--muted-foreground); font-style: italic; }
.qual-timeline--longterm { font-size: 11px; font-weight: 600; color: var(--muted-foreground); }
.qual-timeline-label { font-size: 11px; font-weight: 600; color: var(--muted-foreground); }
.qual-file-row { display: flex; align-items: center; gap: 8px; margin: 0 -6px; padding: 8px 10px; border-radius: 10px; cursor: pointer; transition: background .15s ease; }
.qual-file-row:hover { background: oklch(0.985 0.01 258 / 0.6); }
.qual-file-row--empty { cursor: default; }
.qual-file-row--empty:hover { background: transparent; }
.qual-file-icon { width: 28px; height: 28px; border-radius: 8px; background: color-mix(in oklab, var(--brand) 10%, transparent); display: flex; align-items: center; justify-content: center; color: var(--brand); flex-shrink: 0; }
.qual-file-icon--muted { background: transparent; color: var(--muted-foreground); }
.qual-file-name { flex: 1; font-size: 12px; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.qual-file-name--muted { color: var(--muted-foreground); font-weight: 400; }
.qual-file-cta { font-size: 11px; font-weight: 700; color: var(--brand); flex-shrink: 0; opacity: 0; transform: translateX(-4px); transition: opacity .15s ease, transform .15s ease; }
.qual-file-row:hover .qual-file-cta { opacity: 1; transform: translateX(0); }
.qual-health-dashboard { position: relative; display: flex; align-items: center; gap: 20px; padding: 18px 22px; margin-bottom: 14px; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.qual-health-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
.qual-health-ring-arc { transition: stroke-dasharray .8s ease; }
.qual-health-score { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; color: var(--foreground); }
.qual-health-body { flex: 1; min-width: 0; }
.qual-health-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.qual-health-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.qual-health-chip .chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.qual-health-chip.valid     { background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.qual-health-chip.valid .chip-dot     { background: var(--success); }
.qual-health-chip.long-term { background: color-mix(in oklab, var(--brand) 12%, transparent); color: var(--brand); }
.qual-health-chip.long-term .chip-dot { background: var(--brand); }
.qual-health-chip.expiring  { background: color-mix(in oklab, var(--warning) 12%, transparent); color: var(--warning); }
.qual-health-chip.expiring .chip-dot  { background: var(--warning); }
.qual-health-chip.expired   { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
.qual-health-chip.expired .chip-dot   { background: var(--danger); }
.qual-health-message { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--c, var(--muted-foreground)); }
.qual-empty { position: relative; text-align: center; padding: 64px 24px; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.qual-empty-icon  { color: var(--muted-foreground); margin-bottom: 8px; }
.qual-empty-title { font-size: 15px; font-weight: 700; color: var(--muted-foreground); margin: 12px 0 4px; }
.qual-empty-desc  { font-size: 13px; color: var(--muted-foreground); margin: 0; }

/* ═══ Qual add panel (Teleport) ═══ */
.add-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.add-panel { position: relative; width: 540px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border: none; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.add-panel-head { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.add-panel-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.add-panel-head-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.add-panel-title { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); letter-spacing: -0.01em; }
.add-panel-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.add-panel-close { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); transition: all 0.15s; }
.add-panel-close:hover { color: var(--brand); transform: translateY(-1px); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.add-panel-body { position: relative; flex: 1; overflow-y: auto; padding: 18px 26px; }
.add-panel-sec { margin-bottom: 18px; }
.add-panel-sec:last-of-type { margin-bottom: 0; }
.add-panel-sec-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 12px; }
.add-panel-sec-label i { color: var(--danger); font-style: normal; font-weight: 900; }
.add-panel-sec-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.add-panel-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.add-panel-field { display: flex; flex-direction: column; gap: 7px; position: relative; }
.add-panel-label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.add-panel-label i { font-style: normal; color: var(--danger); margin-left: 2px; }
.add-panel-label--opt { color: var(--muted-foreground); font-weight: 600; }
.add-panel-input-wrap { position: relative; }
.add-panel-count { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 600; color: var(--muted-foreground); font-variant-numeric: tabular-nums; user-select: none; pointer-events: none; }
.add-panel-input { width: 100%; height: 42px; padding: 0 14px; font-size: 14px; color: var(--ink); font-family: inherit; background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.add-panel-input::placeholder { color: oklch(0.74 0.02 258); }
.add-panel-input:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.add-panel-select { width: 100%; height: 42px; padding: 0 36px 0 14px; font-size: 14px; color: var(--ink); font-family: inherit; background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; appearance: none; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.add-panel-select:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.add-panel-select-arrow { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--muted-foreground); pointer-events: none; }
.add-panel-upload { position: relative; }
.add-panel-upload-drop { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 20px 22px; border: none; border-radius: 10px; text-align: center; background: var(--surface); box-shadow: inset 1px 1px 3px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.6); transition: box-shadow 0.15s ease; }
.add-panel-upload-drop:hover { box-shadow: inset 1px 1px 4px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 3px oklch(1 0 0 / 0.65); }
.add-panel-upload-drop-icon { color: var(--muted-foreground); transition: color 0.15s; margin-bottom: 2px; }
.add-panel-upload-drop:hover .add-panel-upload-drop-icon { color: var(--brand); }
.add-panel-upload-drop-text { font-size: 13px; font-weight: 600; color: var(--foreground); margin: 0; }
.add-panel-upload-drop-hint { font-size: 11px; color: var(--muted-foreground); margin: 0; }
.add-panel-upload-btn { display: inline-flex; align-items: center; gap: 7px; margin-top: 6px; padding: 9px 20px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); transition: all 0.18s cubic-bezier(0.22, 0.61, 0.36, 1); font-family: inherit; }
.add-panel-upload-btn:hover { background: var(--brand-deep); transform: translateY(-1px); box-shadow: 4px 4px 10px oklch(0.45 0.08 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.55); }
.add-panel-upload-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4); }
.add-panel-upload-file { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: none; border-radius: 10px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.06), -1px -1px 1px oklch(1 0 0 / 0.7); }
.add-panel-upload-file-icon { width: 38px; height: 38px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 12%, transparent); display: flex; align-items: center; justify-content: center; color: var(--brand); flex-shrink: 0; }
.add-panel-upload-file-info { flex: 1; min-width: 0; }
.add-panel-upload-file-name { display: block; font-size: 13px; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-panel-upload-file-meta { display: block; font-size: 11px; color: var(--muted-foreground); margin-top: 1px; font-variant-numeric: tabular-nums; }
.add-panel-upload-replace { background: none; border: none; font-size: 12px; font-weight: 600; color: var(--brand); cursor: pointer; font-family: inherit; padding: 0; transition: opacity 0.15s; }
.add-panel-upload-replace:hover { opacity: 0.7; }
.add-panel-upload-progress { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: var(--hairline); border-radius: 0 0 10px 10px; overflow: hidden; }
.add-panel-upload-progress-bar { height: 100%; background: var(--brand); transition: width 0.3s ease; border-radius: 0 1px 1px 0; }
.add-panel-foot { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.add-panel-hint { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.add-panel-hint.ready { color: var(--success); }
.add-panel-foot-actions { display: flex; gap: 10px; flex-shrink: 0; }
.add-panel-btn-cancel { padding: 10px 20px; border-radius: 9px; border: none; background: var(--surface); color: var(--foreground); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); transition: all 0.15s; }
.add-panel-btn-cancel:hover { color: var(--brand); transform: translateY(-1px); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.add-panel-btn-submit { display: inline-flex; align-items: center; gap: 6px; padding: 10px 22px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); transition: all 0.18s; }
.add-panel-btn-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4); }
.add-panel-btn-submit.ready:hover { background: var(--brand-deep); transform: translateY(-1px); box-shadow: 4px 4px 10px oklch(0.45 0.08 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.55); }
.add-panel-enter-active, .add-panel-leave-active { transition: opacity 0.22s ease; }
.add-panel-enter-active .add-panel, .add-panel-leave-active .add-panel { transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.22s ease; }
.add-panel-enter-from, .add-panel-leave-to { opacity: 0; }
.add-panel-enter-from .add-panel, .add-panel-leave-to .add-panel { transform: scale(0.96) translateY(12px); opacity: 0; }
.add-fade-enter-active { transition: opacity 0.2s ease; }
.add-fade-leave-active { transition: opacity 0.15s ease; }
.add-fade-enter-from, .add-fade-leave-to { opacity: 0; }

/* ═══ Contact panel (Teleport) ═══ */
.ct-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.ct-panel { position: relative; width: 480px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border: none; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.ct-panel-head { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.ct-panel-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ct-panel-head-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.ct-panel-title { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); letter-spacing: -0.01em; }
.ct-panel-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.ct-panel-close { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); transition: all 0.15s; }
.ct-panel-close:hover { color: var(--brand); transform: translateY(-1px); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.ct-panel-body { position: relative; flex: 1; overflow-y: auto; padding: 18px 26px; }
.ct-panel-sec { margin-bottom: 4px; }
.ct-panel-sec-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 12px; }
.ct-panel-sec-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.ct-panel-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ct-panel-field { display: flex; flex-direction: column; gap: 7px; }
.ct-panel-field--toggle { flex-direction: row; align-items: center; justify-content: space-between; }
.ct-panel-field--toggle .ct-panel-label { margin-bottom: 0; }
.ct-panel-label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.ct-panel-label i { font-style: normal; color: var(--danger); margin-left: 2px; }
.ct-panel-label--opt { color: var(--muted-foreground); font-weight: 600; }
.ct-panel-input { width: 100%; height: 42px; padding: 0 14px; font-size: 14px; color: var(--ink); font-family: inherit; background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.ct-panel-input::placeholder { color: oklch(0.74 0.02 258); }
.ct-panel-input:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.ct-toggle { position: relative; width: 44px; height: 26px; border-radius: 13px; border: none; background: oklch(0.94 0.01 258); cursor: pointer; transition: background 0.2s ease, box-shadow 0.2s ease; padding: 0; flex-shrink: 0; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.ct-toggle.active { background: var(--brand); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.25), 2px 2px 5px oklch(0.4 0.1 258 / 0.25); }
.ct-toggle-knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 1px 1px 3px oklch(0.55 0.03 258 / 0.25); transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1); }
.ct-toggle.active .ct-toggle-knob { transform: translateX(18px); }
.ct-panel-foot { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.ct-panel-hint { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.ct-panel-hint.ready { color: var(--success); }
.ct-panel-foot-actions { display: flex; gap: 10px; flex-shrink: 0; }
.ct-panel-btn-cancel { padding: 10px 20px; border-radius: 9px; border: none; background: var(--surface); color: var(--foreground); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); transition: all 0.15s; }
.ct-panel-btn-cancel:hover { color: var(--brand); transform: translateY(-1px); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.ct-panel-btn-submit { display: inline-flex; align-items: center; gap: 6px; padding: 10px 22px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); transition: all 0.18s; }
.ct-panel-btn-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4); }
.ct-panel-btn-submit.ready:hover { background: var(--brand-deep); transform: translateY(-1px); box-shadow: 4px 4px 10px oklch(0.45 0.08 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.55); }
.ct-panel-enter-active, .ct-panel-leave-active { transition: opacity 0.22s ease; }
.ct-panel-enter-active .ct-panel, .ct-panel-leave-active .ct-panel { transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.22s ease; }
.ct-panel-enter-from, .ct-panel-leave-to { opacity: 0; }
.ct-panel-enter-from .ct-panel, .ct-panel-leave-to .ct-panel { transform: scale(0.96) translateY(12px); opacity: 0; }

/* ═══ Responsive ═══ */
@media (max-width: 768px) { .company-identity { flex-direction: column; align-items: stretch; } .info-grid { grid-template-columns: 1fr; } .qual-health-dashboard { flex-direction: column; align-items: flex-start; } .add-panel-row { grid-template-columns: 1fr; } .ct-panel-row { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .qual-card,.qual-timeline-fill,.qual-file-cta,.add-panel-close,.add-panel-upload-btn,.add-panel-btn-cancel,.add-panel-btn-submit,.ct-panel-close,.ct-panel-btn-cancel,.ct-panel-btn-submit,.ct-toggle,.ct-toggle-knob,.info-tag-chip { transition: none; } .info-tag-chip:hover { transform: none; } }

/* ═══ Change request dialog ═══ */
.crp-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.crp-panel { position: relative; width: 640px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.crp-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.crp-head-l { display: flex; align-items: center; gap: 14px; min-width: 0; }
.crp-head-i { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.crp-title { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); }
.crp-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.crp-x { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.crp-x:hover { color: var(--brand); transform: translateY(-1px); }
.crp-body { flex: 1; overflow-y: auto; padding: 18px 26px; }
.crp-bar { display: flex; gap: 4px; margin-bottom: 18px; padding: 4px; border-radius: 14px; background: oklch(0.96 0.008 258); box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.6); }
.crp-bar .neu-tab { flex: 1; justify-content: center; }
.crp-cnt { display: flex; align-items: center; gap: 10px; padding: 10px 16px; margin-bottom: 14px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 6%, oklch(0.985 0.005 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5); font-size: 13px; font-weight: 600; color: var(--foreground); }
.crp-cnt-n { font-size: 22px; font-weight: 900; color: var(--brand); line-height: 1; }
.crp-fs { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
.crp-f { display: flex; flex-direction: column; gap: 6px; }
.crp-f.dirty { padding: 12px; margin: -4px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 5%, oklch(0.99 0.004 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.4), inset 1px 1px 3px oklch(0.55 0.03 258 / 0.06), inset -1px -1px 3px oklch(1 0 0 / 0.5); }
.crp-fh { display: flex; align-items: center; justify-content: space-between; }
.crp-fh label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.crp-tag { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 6px; background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.crp-ov { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: oklch(0.55 0.03 258 / 0.05); }
.crp-ovl { font-size: 10px; font-weight: 800; color: var(--muted-foreground); text-transform: uppercase; }
.crp-ovv { flex: 1; font-size: 12px; color: var(--muted-foreground); text-decoration: line-through; word-break: break-all; }
.crp-n { font-size: 11px; font-weight: 600; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.crp-ft { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.crp-ft-h { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.crp-ft-h.ok { color: var(--success); }
.crp-ft .neu-btn-group { flex-shrink: 0; }
.qc { position: relative; display: flex; flex-direction: column; padding: 14px 16px; margin-bottom: 10px; border-radius: 14px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 3px 3px 8px oklch(0.55 0.03 258 / 0.07), -2px -2px 6px oklch(1 0 0 / 0.8), inset 0 1px 0 oklch(1 0 0 / 0.6); transition: transform .15s; }
.qc:hover { transform: translateY(-1px); }
.qc-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qc-hl { display: flex; align-items: center; gap: 6px; min-width: 0; }
.qc-d { width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent); flex-shrink: 0; font-size: 11px; }
.qc-t { font-size: 11px; font-weight: 700; color: var(--c); }
.qc-hr { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.qc-st { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.qc-st.approved { background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.qc-st.pending  { background: color-mix(in oklab, var(--warning) 12%, transparent); color: var(--warning); }
.qc-st.rejected { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
.qc-del { color: var(--muted-foreground); padding: 2px; opacity: 0; transition: opacity .15s; }
.qc:hover .qc-del { opacity: 1; }
.qc-del:hover { color: var(--danger) !important; }
.qc-nm { margin: 8px 0 10px; font-size: 14px; font-weight: 700; color: var(--foreground); }
.qc-tl { margin-bottom: 10px; }
.qc-tb { height: 4px; background: var(--hairline); border-radius: 2px; overflow: hidden; }
.qc-tf { height: 100%; border-radius: 2px; transition: width .8s ease; min-width: 4px; background: var(--c, var(--brand)); }
.qc-td { display: flex; justify-content: space-between; margin-top: 4px; font-size: 10px; font-weight: 600; color: var(--muted-foreground); }
.qc-fr { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: background .15s; }
.qc-fr:hover { background: oklch(0.985 0.01 258 / 0.6); }
.qc-fi { width: 24px; height: 24px; border-radius: 6px; background: color-mix(in oklab, var(--brand) 10%, transparent); display: flex; align-items: center; justify-content: center; color: var(--brand); flex-shrink: 0; }
.qc-fn { flex: 1; font-size: 11px; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qc-fa { font-size: 10px; font-weight: 700; color: var(--brand); flex-shrink: 0; opacity: 0; transform: translateX(-4px); transition: opacity .15s, transform .15s; }
.qc-fr:hover .qc-fa { opacity: 1; transform: translateX(0); }
.qc-atch { margin-top: 10px; width: 100%; justify-content: center; }
.qc-tl--lt { font-size: 11px; font-weight: 600; color: var(--muted-foreground); }
.qc-e { text-align: center; padding: 40px 20px; color: var(--muted-foreground); }
.qc-e p { margin: 8px 0 0; font-size: 13px; font-weight: 700; }
.crcell { display: flex; align-items: center; gap: 8px; }
.crav { background: var(--brand); font-size: 12px; }
.crnm { font-weight: 700; font-size: 13px; color: var(--foreground); }
</style>

<style>
.dlg-enter-active, .dlg-leave-active { transition: opacity .22s; }
.dlg-enter-active .crp-panel, .dlg-leave-active .crp-panel { transition: transform .26s cubic-bezier(.22,.61,.36,1), opacity .22s; }
.dlg-enter-from, .dlg-leave-to { opacity: 0; }
.dlg-enter-from .crp-panel, .dlg-leave-to .crp-panel { transform: scale(.96) translateY(12px); opacity: 0; }
</style>
