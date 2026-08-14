<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { createDialogLeaveGuard } from '@/composables'
import SpPageHero from '@/components/SpPageHero.vue'
import { FileEdit, AlertTriangle, Inbox } from 'lucide-vue-next'

const supplierStore = useSupplierStore()
const loading = ref(true); const error = ref(false)

// ═══════ 弹窗 ═══════
const dialogVisible = ref(false)
const dialogMode = ref<'basic' | 'quals' | 'contacts'>('basic')

// ═══════ 基本资料 ═══════
const EDIT_FIELDS = [
  { key: 'name', label: '企业名称', type: 'text', placeholder: '请输入企业全称' },
  { key: 'enterpriseType', label: '企业类型', type: 'text', placeholder: '如：有限责任公司' },
  { key: 'legalPerson', label: '法定代表人', type: 'text', placeholder: '请输入法定代表人姓名' },
  { key: 'registeredAddress', label: '注册地址', type: 'textarea', placeholder: '请输入企业注册地址' },
  { key: 'businessScope', label: '经营范围', type: 'textarea', placeholder: '请输入经营范围' },
] as const
const form = reactive<Record<string, string>>({})
const original = reactive<Record<string, string>>({})
const reason = ref(''); const submitting = ref(false); const profileLoaded = ref(false)
const isModified = (k: string) => (form[k] ?? '') !== (original[k] ?? '') && (form[k] ?? '').trim() !== ''
const changedFields = computed(() => EDIT_FIELDS.filter(f => isModified(f.key)))
const hasChanges = computed(() => changedFields.value.length > 0)

async function openDialog() {
  dialogVisible.value = true; dialogMode.value = 'basic'
  if (!profileLoaded.value) {
    try { await supplierStore.fetchProfile() } catch { ElMessage.error('加载企业资料失败'); return }
    profileLoaded.value = true
  }
  const p = supplierStore.profile; if (!p) return
  EDIT_FIELDS.forEach(f => { const v = (p[f.key] as string) ?? ''; form[f.key] = v; original[f.key] = v })
  reason.value = ''
}
function closeDialog() { dialogVisible.value = false }
function resetBasicField(k: string) { form[k] = original[k] }
function resetAllBasic() { EDIT_FIELDS.forEach(f => form[f.key] = original[f.key]); reason.value = '' }
async function handleBasicSubmit() {
  if (!hasChanges.value) { ElMessage.warning('请至少修改一项资料'); return }
  if (!reason.value.trim()) { ElMessage.warning('请填写变更原因'); return }
  const lines = changedFields.value.map(f => `<div style="margin:6px 0"><b style="color:#064ea2">${f.label}</b><br/><span style="color:#94a3b8;text-decoration:line-through">${esc(original[f.key]||'（空）')}</span> → <span style="color:#059669;font-weight:600">${esc(form[f.key])}</span></div>`).join('')
  try { await ElMessageBox.confirm(`<div style="font-size:13px;line-height:1.6">将提交 <b>${changedFields.value.length}</b> 项变更：${lines}<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);color:#64748b">变更原因：${esc(reason.value)}</div></div>`, '确认提交变更', { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }) } catch { return }
  submitting.value = true; let ok = 0, fail = 0
  for (const f of changedFields.value) { try { await supplierStore.createChangeRequest({ fieldName: f.key, fieldLabel: f.label, oldValue: original[f.key] || '', newValue: form[f.key], reason: reason.value.trim() }); ok++ } catch { fail++ } }
  submitting.value = false
  if (ok > 0 && fail === 0) { ElMessage.success(`已提交 ${ok} 项变更申请，等待审核`); closeDialog() }
  else if (ok > 0) { ElMessage.warning(`部分成功：${ok} 项成功，${fail} 项失败`); closeDialog() }
  else { ElMessage.error('提交失败') }
}
function esc(s: string): string { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!)) }

// ═══════ 资质管理 ═══════
const qualsLoading = ref(false)
const qualDlg = ref(false); const qualDlgLoading = ref(false)
const qualUp = ref(false); const qualUpPct = ref<number | null>(null)
const upMeta = ref<FileAssetResponse | null>(null)
const qualFm = ref({ type: '', name: '', fileUrl: '', validFrom: '', validTo: '' })
const qualDirty = ref(false)
const qualGuard = createDialogLeaveGuard(qualDirty)
function qDirty() { qualDirty.value = true }
async function qClose() { await qualGuard(() => { qualDlg.value = false; qualDirty.value = false }) }
const qualTypes = ['营业执照','资质证书','安全生产许可证','质量管理体系认证','环境管理体系认证','职业健康安全管理体系认证','其他']
const qualTokens: Record<string, { token: string; value: string; icon: string }> = {
  '营业执照':{token:'var(--brand)',value:'oklch(0.5 0.16 258)',icon:'Stamp'},'资质证书':{token:'var(--brand-deep)',value:'oklch(0.42 0.16 258)',icon:'Medal'},
  '安全生产许可证':{token:'var(--warning)',value:'oklch(0.72 0.15 72)',icon:'Lock'},'质量管理体系认证':{token:'var(--success)',value:'oklch(0.64 0.15 152)',icon:'CircleCheck'},
  '环境管理体系认证':{token:'var(--water)',value:'oklch(0.5 0.12 175)',icon:'Sunny'},'职业健康安全管理体系认证':{token:'var(--danger)',value:'oklch(0.62 0.21 27)',icon:'User'},
}
function qMeta(t: string) { return qualTokens[t] || { token: 'var(--muted-foreground)', value: 'oklch(0.6 0.02 258)', icon: 'More' } }
async function qUp(o: any) { const f=o.file as File; if(f.size>50*1024*1024){ElMessage.error('文件不能超过50MB');o.onError(new Error('FILE_TOO_LARGE'));return} qualUp.value=true;qualUpPct.value=0; try{const r=await uploadFile(f,'qualification',p=>qualUpPct.value=p);qualFm.value.fileUrl=r.url;upMeta.value=r;o.onSuccess(r);ElMessage.success('上传成功');qDirty()}catch(e:any){o.onError(e)}finally{qualUp.value=false;qualUpPct.value=null} }
function qFmt(b:number):string{if(b<1024)return`${b} B`;if(b<1024*1024)return`${(b/1024).toFixed(1)} KB`;return`${(b/1024/1024).toFixed(1)} MB`}
async function qAdd(){if(!qualFm.value.type||!qualFm.value.name){ElMessage.warning('请填写资质类型和名称');return};if(!upMeta.value||!qualFm.value.fileUrl){ElMessage.warning('请先上传资质文件');return};qualDlgLoading.value=true;try{await supplierStore.addQualification(qualFm.value);ElMessage.success('资质添加成功');qualDlg.value=false;qualDirty.value=false}catch{ElMessage.error('添加失败')}finally{qualDlgLoading.value=false}}
async function qDel(id:string){await ElMessageBox.confirm('确定要删除此资质材料吗？','提示',{type:'warning'});try{await supplierStore.deleteQualification(id);ElMessage.success('已删除')}catch{ElMessage.error('删除失败')}}
function qSt(q:any){if(!q.validTo)return{label:'长期有效',cls:'approved'};const d=(new Date(q.validTo).getTime()-Date.now())/86400000;if(d<0)return{label:'已过期',cls:'rejected'};if(d<30)return{label:'即将过期',cls:'pending'};return{label:'有效',cls:'approved'}}
function qPct(q:any):number{if(!q.validFrom||!q.validTo)return 100;const t=new Date(q.validTo).getTime()-new Date(q.validFrom).getTime();const r=new Date(q.validTo).getTime()-Date.now();return Math.max(0,Math.min(100,Math.round((r/t)*100)))}
function qFn(url:string):string{if(!url)return'';const m=url.match(/\/([^/]+\.\w{2,5})$/i);return m?m[1]:'附件文件'}

// ═══════ 联系人 ═══════
const ctLoading = ref(false)
const ctDlg = ref(false); const ctDlgLoading = ref(false)
const ctEdit = ref(false); const ctEid = ref('')
const ctFm = ref({ name:'', phone:'', email:'', isPrimary:false }); const ctDirty = ref(false)
const ctGuard = createDialogLeaveGuard(ctDirty)
function ctD() { ctDirty.value = true }
async function ctClose() { await ctGuard(() => { ctDlg.value = false; ctDirty.value = false }) }
function ctOpenAdd(){ctEdit.value=false;ctEid.value='';ctFm.value={name:'',phone:'',email:'',isPrimary:false};ctDirty.value=false;ctDlg.value=true}
function ctOpenEdit(c:any){ctEdit.value=true;ctEid.value=c.id;ctFm.value={name:c.name,phone:c.phone,email:c.email||'',isPrimary:c.isPrimary};ctDirty.value=false;ctDlg.value=true}
async function ctSb(){if(!ctFm.value.name||!ctFm.value.phone){ElMessage.warning('请填写姓名和手机号');return};if(!/^1[3-9]\d{9}$/.test(ctFm.value.phone)){ElMessage.warning('请输入正确的11位手机号');return};ctDlgLoading.value=true;try{if(ctEdit.value){await supplierStore.updateContact(ctEid.value,ctFm.value);ElMessage.success('更新成功')}else{await supplierStore.addContact(ctFm.value);ElMessage.success('添加成功')};ctDlg.value=false;ctDirty.value=false}catch{ElMessage.error(ctEdit.value?'更新失败':'添加失败')}finally{ctDlgLoading.value=false}}
async function ctDel(id:string){await ElMessageBox.confirm('确定要删除此联系人吗？','提示',{type:'warning'});try{await supplierStore.deleteContact(id);ElMessage.success('已删除')}catch{ElMessage.error('删除失败')}}

// ═══════ 弹窗内 tab 切换加载 ═══════
async function switchDialogMode(m: typeof dialogMode.value) {
  dialogMode.value = m
  if (m === 'quals') { qualsLoading.value = true; try { await supplierStore.fetchQualifications() } catch {} finally { qualsLoading.value = false } }
  if (m === 'contacts') { ctLoading.value = true; try { await supplierStore.fetchContacts() } catch {} finally { ctLoading.value = false } }
}

// ═══════ 生命周期 ═══════
onMounted(async () => { try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false } })
async function retry() { error.value = false; loading.value = true; try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false } }

// ═══════ 记录辅助 ═══════
const STATUS: Record<string, { label: string; color: string; icon: string }> = {
  PENDING:  { label: '已申请', color: 'var(--warning)', icon: 'Clock' },
  APPROVED: { label: '已同意', color: 'var(--success)', icon: 'CircleCheckFilled' },
  REJECTED: { label: '已拒绝', color: 'var(--danger)',  icon: 'CircleCloseFilled' },
}
function since(ts: string): string { const d = Math.ceil((Date.now() - new Date(ts).getTime()) / 86400000); if (d > 0) return `${d} 天`; const h = Math.ceil((Date.now() - new Date(ts).getTime()) / 3600000); return h > 0 ? `${h} 小时` : '刚刚' }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div><div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retry">重新加载</el-button>
    </div>
    <template v-else-if="!loading">
      <SpPageHero :icon="FileEdit" eyebrow="申请记录" title="资料变更" sub="查看企业资料变更申请的处理进度与历史记录。">
        <template #actions />
      </SpPageHero>

      <!-- ═══ 变更记录时间线 ═══ -->
      <div v-if="supplierStore.changeRecords.length > 0" class="cr-list">
        <div v-for="r in supplierStore.changeRecords" :key="r.id" class="cr-card" :style="{ '--st': STATUS[r.status]?.color || 'var(--muted-foreground)' } as any">
          <div class="cr-rail" />
          <div class="cr-body">
            <div class="cr-top"><span class="cr-badge">{{ r.fieldLabel }}</span><span class="cr-pill"><el-icon :size="13"><component :is="STATUS[r.status]?.icon || 'InfoFilled'" /></el-icon>{{ STATUS[r.status]?.label || r.status }}</span></div>
            <div class="cr-diff"><div class="cr-diff-o"><span class="cr-diff-lbl">原值</span><span class="cr-diff-v">{{ r.oldValue || '—' }}</span></div><div class="cr-diff-ar"><el-icon :size="16"><ArrowRight /></el-icon></div><div class="cr-diff-n"><span class="cr-diff-lbl">新值</span><span class="cr-diff-v">{{ r.newValue }}</span></div></div>
            <div v-if="r.reason" class="cr-why"><el-icon :size="13"><ChatLineSquare /></el-icon><span>{{ r.reason }}</span></div>
            <div class="cr-foot"><span class="cr-ft">{{ dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') }}</span><span v-if="r.status==='PENDING'" class="cr-wait"><span class="cr-wdot" />等待 {{ since(r.createdAt) }}</span><span v-if="r.reviewedAt" class="cr-rv">审核于 {{ dayjs(r.reviewedAt).format('MM-DD HH:mm') }}</span></div>
          </div>
        </div>
      </div>
      <div v-else class="cr-empty"><div class="sp-empty-icon"><Inbox :size="22" :stroke-width="1.75" /></div><div class="cr-empty-title">暂无申请记录</div><div class="cr-empty-desc">请在企业信息页点击「申请资料变更」提交变更，申请提交后将在此显示处理进度</div></div>

      <!-- ═══════ 弹窗（Teleport）═══════ -->
      <Teleport to="body"><Transition name="dlg"><div v-if="dialogVisible" class="dlg-overlay" @click.self="closeDialog"><div class="dlg-panel">
        <div class="dlg-head"><div class="dlg-head-l"><div class="dlg-head-i"><el-icon :size="20"><EditPen /></el-icon></div><div><h2 class="dlg-t">申请资料变更</h2><p class="dlg-sub">选择变更类别，编辑对应内容后提交</p></div></div><button class="dlg-x" @click="closeDialog"><el-icon :size="18"><Close /></el-icon></button></div>
        <div class="dlg-body">
          <!-- 类别选择器 -->
          <div class="mode-bar">
            <button class="neu-tab" :class="{ active: dialogMode === 'basic', 'is-active': dialogMode === 'basic' }" @click="switchDialogMode('basic')">基本资料</button>
            <button class="neu-tab" :class="{ active: dialogMode === 'quals', 'is-active': dialogMode === 'quals' }" @click="switchDialogMode('quals')">资质与证照</button>
            <button class="neu-tab" :class="{ active: dialogMode === 'contacts', 'is-active': dialogMode === 'contacts' }" @click="switchDialogMode('contacts')">联系人</button>
          </div>

          <!-- ══ 基本资料 ══ -->
          <div v-if="dialogMode==='basic'">
            <div v-if="hasChanges" class="ed-ctr"><span class="ed-ctr-n">{{ changedFields.length }}</span><span>项修改</span></div>
            <div class="ed-fs">
              <div v-for="f in EDIT_FIELDS" :key="f.key" class="ed-f" :class="{ dirty: isModified(f.key) }">
                <div class="ed-fh"><label class="ed-lbl">{{ f.label }}</label><span v-if="isModified(f.key)" class="ed-tag">已修改</span></div>
                <div v-if="isModified(f.key) && original[f.key]" class="ed-ov"><span class="ed-ovl">原值</span><span class="ed-ovv">{{ original[f.key] }}</span><button class="neu-btn-xs" @click="resetBasicField(f.key)">还原</button></div>
                <input v-if="f.type==='text'" class="neu-input" v-model="form[f.key]" :placeholder="f.placeholder" />
                <textarea v-else class="neu-input" v-model="form[f.key]" :rows="f.key==='businessScope'?3:2" :placeholder="f.placeholder" />
              </div>
            </div>
            <div class="ed-f"><label class="ed-lbl">变更原因</label><span class="ed-n">{{ reason.length }}/200</span><textarea class="neu-input" v-model="reason" :rows="3" maxlength="200" placeholder="请说明本次变更的原因" /></div>
          </div>

          <!-- ══ 资质与证照 ══ -->
          <div v-if="dialogMode==='quals'" v-loading="qualsLoading">
            <div style="margin-bottom:12px"><el-button type="primary" @click="qualFm={type:'',name:'',fileUrl:'',validFrom:'',validTo:''};upMeta=null;qualDirty=false;qualDlg=true"><el-icon><Plus /></el-icon>添加资质</el-button></div>
            <el-row v-if="supplierStore.qualifications.length>0" :gutter="12"><el-col :xs="24" :sm="12" v-for="q in supplierStore.qualifications" :key="q.id">
              <article class="qc">
                <div class="qc-h"><div class="qc-hl" :style="{'--c':qMeta(q.type).value} as any"><span class="qc-dot"><el-icon :size="12"><component :is="qMeta(q.type).icon"/></el-icon></span><span class="qc-tp">{{ q.type }}</span></div><div class="qc-hr"><span class="qc-st" :class="qSt(q).cls">{{ qSt(q).label }}</span><el-button class="qc-del" text size="small" @click="qDel(q.id)" title="删除"><el-icon :size="14"><Delete /></el-icon></el-button></div></div>
                <h3 class="qc-nm">{{ q.name }}</h3>
                <div class="qc-tl" v-if="q.validFrom"><div class="qc-tb"><div class="qc-tf" :style="{width:q.validTo?qPct(q)+'%':'100%','--c':qMeta(q.type).value}"/></div><div class="qc-td"><span>{{ dayjs(q.validFrom).format('YYYY-MM-DD') }}</span><span v-if="q.validTo">{{ dayjs(q.validTo).format('YYYY-MM-DD') }}</span><span v-else>长期</span></div></div>
                <div v-else class="qc-tl qc-tl--lt">长期有效</div>
                <div class="qc-fr" v-if="q.fileUrl" @click="window.open(q.fileUrl,'_blank','noopener')"><span class="qc-fi"><el-icon :size="16"><Document /></el-icon></span><span class="qc-fn">{{ qFn(q.fileUrl) }}</span><span class="qc-fa">查看</span></div>
              </article>
            </el-col></el-row>
            <div v-else class="qc-empty"><el-icon :size="28"><Folder /></el-icon><p>暂无资质材料</p></div>
          </div>

          <!-- ══ 联系人 ══ -->
          <div v-if="dialogMode==='contacts'" v-loading="ctLoading">
            <div style="margin-bottom:12px"><el-button type="primary" @click="ctOpenAdd"><el-icon><Plus /></el-icon>添加联系人</el-button></div>
            <div v-if="supplierStore.contacts.length>0" class="neu-table-card">
              <el-table class="neu-table" :data="supplierStore.contacts" stripe>
                <el-table-column label="姓名" prop="name" width="120"><template #default="{row}"><div class="ct-cell"><el-avatar :size="28" class="ct-av">{{ row.name?.charAt(0) }}</el-avatar><span class="ct-nm">{{ row.name }}</span></div></template></el-table-column>
                <el-table-column label="手机号" prop="phone" width="140" />
                <el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column>
                <el-table-column label="操作" width="120" align="center"><template #default="{row}"><el-button link type="primary" @click="ctOpenEdit(row)">编辑</el-button><el-button link type="danger" @click="ctDel(row.id)">删除</el-button></template></el-table-column>
              </el-table>
            </div>
            <div v-else class="qc-empty"><el-icon :size="28"><Phone /></el-icon><p>暂无联系人</p></div>
          </div>
        </div>
        <div class="dlg-foot">
          <span class="dlg-hint" v-if="dialogMode!=='basic'">资质和联系人的修改即时生效，无需审核</span>
          <span class="dlg-hint" v-else-if="!hasChanges">修改任意字段后可提交</span>
          <span class="dlg-hint ready" v-else-if="!reason.trim()">请填写变更原因</span>
          <span class="dlg-hint ready" v-else>{{ changedFields.length }} 项变更待提交</span>
          <div class="dlg-acts">
            <button class="neu-btn-soft" @click="closeDialog">取消</button>
            <button v-if="dialogMode==='basic'" class="neu-btn-primary" :disabled="!hasChanges||!reason.trim()||submitting" @click="handleBasicSubmit">{{ submitting ? '提交中…' : '申请变更' }}</button>
          </div>
        </div>
      </div></div></Transition></Teleport>

      <!-- ═══ 资质弹窗 ═══ -->
      <Teleport to="body"><Transition name="qdlg"><div v-if="qualDlg" class="qov" @click.self="qClose"><div class="qpn">
        <div class="qpn-h"><div class="qpn-hl"><div class="qpn-hi"><el-icon :size="20"><Medal /></el-icon></div><div><h2>添加资质材料</h2><p>上传证照文件并填写有效期</p></div></div><button class="qpn-x" @click="qClose"><el-icon :size="18"><Close /></el-icon></button></div>
        <div class="qpn-b">
          <div class="qpn-s"><div class="qpn-sl"><span class="qpn-sd"/>基本信息</div><div class="qpn-r"><div class="qpn-f"><label>资质类型 <i>*</i></label><select class="qpn-inp" v-model="qualFm.type" @change="qDirty"><option value="" disabled>请选择资质类型</option><option v-for="t in qualTypes" :key="t" :value="t">{{ t }}</option></select><span class="qpn-ar"><el-icon :size="12"><ArrowDown /></el-icon></span></div><div class="qpn-f"><label>资质名称 <i>*</i></label><div class="qpn-iw"><input class="qpn-inp" v-model="qualFm.name" placeholder="如：企业法人营业执照" maxlength="50" @input="qDirty"/><span v-if="qualFm.name" class="qpn-ct">{{ qualFm.name.length }}/50</span></div></div></div></div>
          <div class="qpn-s"><div class="qpn-sl"><span class="qpn-sd"/>有效期</div><div class="qpn-r"><div class="qpn-f"><label class="qpn-l2">有效期起</label><input class="qpn-inp" type="date" v-model="qualFm.validFrom" @change="qDirty"/></div><div class="qpn-f"><label class="qpn-l2">有效期止</label><input class="qpn-inp" type="date" v-model="qualFm.validTo" @change="qDirty"/></div></div></div>
          <div class="qpn-s"><div class="qpn-sl"><span class="qpn-sd"/>资质文件 <i>*</i></div><div class="qpn-up" :class="{'is-ok':upMeta}"><template v-if="!upMeta"><div class="qpn-ud"><span class="qpn-udi"><el-icon :size="28"><UploadFilled /></el-icon></span><p class="qpn-udt">拖拽或点击下方按钮选择文件</p><p class="qpn-udh">支持 PDF、图片、Office、ZIP，≤50MB</p><el-upload :show-file-list="false" :http-request="qUp" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"><button type="button" class="qpn-ub" :disabled="qualUp"><el-icon :size="14"><UploadFilled /></el-icon>{{ qualUp?'上传中…':'选择文件' }}</button></el-upload></div></template><template v-else><div class="qpn-uf"><span class="qpn-ufi"><el-icon :size="18"><Document /></el-icon></span><div class="qpn-ufn"><span class="qpn-ufn1">{{ upMeta.originalName }}</span><span class="qpn-ufn2">{{ qFmt(upMeta.size) }}</span></div><el-upload :show-file-list="false" :http-request="qUp" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"><button type="button" class="qpn-ur">替换</button></el-upload></div></template><Transition name="qfade"><div v-if="qualUpPct!==null" class="qpn-upb"><div class="qpn-upbf" :style="{width:qualUpPct+'%'}"/></div></Transition></div></div>
        </div>
        <div class="qpn-ft"><span class="qpn-h2" v-if="!upMeta">请上传资质文件</span><span class="qpn-h2 ok" v-else>已准备好提交</span><div class="qpn-fa"><button class="qpn-bc" @click="qClose">取消</button><button class="qpn-bs" :disabled="!upMeta||qualDlgLoading" @click="qAdd"><span v-if="qualDlgLoading">提交中…</span><template v-else><el-icon :size="15"><ArrowRight /></el-icon>确认添加</template></button></div></div>
      </div></div></Transition></Teleport>

      <!-- ═══ 联系人弹窗 ═══ -->
      <Teleport to="body"><Transition name="cdlg"><div v-if="ctDlg" class="cov" @click.self="ctClose"><div class="cpn">
        <div class="cpn-h"><div class="cpn-hl"><div class="cpn-hi"><el-icon :size="20"><Phone /></el-icon></div><div><h2>{{ ctEdit?'编辑联系人':'添加联系人' }}</h2><p>{{ ctEdit?'修改联系人信息后保存':'填写企业联系人姓名与联系方式' }}</p></div></div><button class="cpn-x" @click="ctClose"><el-icon :size="18"><Close /></el-icon></button></div>
        <div class="cpn-b"><div class="cpn-s"><div class="cpn-sl"><span class="cpn-sd"/>基本信息</div><div class="cpn-r"><div class="cpn-f"><label>姓名 <i>*</i></label><input class="cpn-inp" v-model="ctFm.name" placeholder="请输入姓名" maxlength="20" @input="ctD"/></div><div class="cpn-f"><label>手机号 <i>*</i></label><input class="cpn-inp" v-model="ctFm.phone" placeholder="请输入11位手机号" maxlength="11" @input="ctD"/></div></div><div class="cpn-r" style="margin-top:14px"><div class="cpn-f"><label class="cpn-l2">邮箱</label><input class="cpn-inp" v-model="ctFm.email" placeholder="选填" @input="ctD"/></div><div class="cpn-f cpn-f--tg"><label class="cpn-l2">主要联系人</label><button type="button" class="cpn-tg" :class="{on:ctFm.isPrimary}" @click="ctFm.isPrimary=!ctFm.isPrimary;ctD()"><span class="cpn-tgk"/></button></div></div></div></div>
        <div class="cpn-ft"><span class="cpn-h2" v-if="!ctFm.name&&!ctFm.phone">请填写联系人信息</span><span class="cpn-h2 ok" v-else>信息已就绪</span><div class="cpn-fa"><button class="cpn-bc" @click="ctClose">取消</button><button class="cpn-bs" :disabled="!ctFm.name||!ctFm.phone||ctDlgLoading" @click="ctSb"><span v-if="ctDlgLoading">保存中…</span><template v-else><el-icon :size="15"><ArrowRight /></el-icon>{{ ctEdit?'保存':'确认添加' }}</template></button></div></div>
      </div></div></Transition></Teleport>
    </template>
  </div>
</template>

<style scoped>
/* ═══ Records ═══ */
.cr-list { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.cr-card { position: relative; display: flex; overflow: hidden; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); transition: transform .18s ease, box-shadow .18s ease; }
.cr-card:hover { transform: translateY(-1px); box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.cr-rail { width: 4px; flex-shrink: 0; background: var(--st); }
.cr-body { flex: 1; min-width: 0; padding: 16px 20px; }
.cr-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.cr-badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 7px; background: color-mix(in oklab, var(--brand) 12%, transparent); color: var(--brand); font-size: 12px; font-weight: 800; }
.cr-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: color-mix(in oklab, var(--st, #94a3b8) 12%, transparent); color: var(--st); font-size: 12px; font-weight: 700; }
.cr-diff { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; margin-bottom: 10px; background: oklch(0.97 0.01 258 / 0.5); box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 5px oklch(1 0 0 / 0.6); }
.cr-diff-o, .cr-diff-n { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cr-diff-lbl { font-size: 10px; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; }
.cr-diff-o .cr-diff-v { font-size: 13px; color: var(--muted-foreground); text-decoration: line-through; word-break: break-all; }
.cr-diff-n .cr-diff-v { font-size: 14px; color: var(--foreground); font-weight: 700; word-break: break-all; }
.cr-diff-ar { flex-shrink: 0; color: var(--st); opacity: .6; }
.cr-why { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 10px; font-size: 12px; color: var(--foreground); line-height: 1.5; }
.cr-why .el-icon { flex-shrink: 0; margin-top: 1px; color: var(--muted-foreground); }
.cr-foot { display: flex; align-items: center; gap: 14px; padding-top: 10px; border-top: 1px solid var(--hairline); font-size: 11px; }
.cr-ft { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.cr-wait { display: inline-flex; align-items: center; gap: 5px; color: var(--warning); font-weight: 600; }
.cr-wdot { width: 6px; height: 6px; border-radius: 50%; background: var(--warning); animation: dot 2s ease-in-out infinite; }
.cr-rv { margin-left: auto; color: var(--muted-foreground); }
@keyframes dot { 0%,100%{opacity:1} 50%{opacity:.4} }
.cr-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 64px 24px; margin-top: 16px; border-radius: 16px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7); }
.cr-empty-title { font-size: 16px; font-weight: 800; color: var(--foreground); }
.cr-empty-desc { margin-top: 6px; font-size: 13px; color: var(--muted-foreground); max-width: 420px; margin-inline: auto; line-height: 1.5; }

/* ═══ Dialog ═══ */
.dlg-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.dlg-panel { position: relative; width: 640px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.dlg-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.dlg-head-l { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dlg-head-i { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.dlg-t { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); }
.dlg-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.dlg-x { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.dlg-x:hover { color: var(--brand); transform: translateY(-1px); }
.dlg-body { flex: 1; overflow-y: auto; padding: 18px 26px; }
.dlg-foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.dlg-hint { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.dlg-hint.ready { color: var(--success); }
.dlg-acts { display: flex; gap: 10px; flex-shrink: 0; }

/* Mode bar */
.mode-bar { display: flex; gap: 4px; margin-bottom: 18px; padding: 4px; border-radius: 14px; background: oklch(0.96 0.008 258); box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.6); }
.mode-bar .neu-tab { flex: 1; justify-content: center; }

/* Edit fields */
.ed-ctr { display: flex; align-items: center; gap: 10px; padding: 10px 16px; margin-bottom: 14px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 6%, oklch(0.985 0.005 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5); font-size: 13px; font-weight: 600; color: var(--foreground); }
.ed-ctr-n { font-size: 22px; font-weight: 900; color: var(--brand); line-height: 1; }
.ed-fs { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
.ed-f { display: flex; flex-direction: column; gap: 6px; }
.ed-f.dirty { padding: 12px; margin: -4px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 5%, oklch(0.99 0.004 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.4), inset 1px 1px 3px oklch(0.55 0.03 258 / 0.06), inset -1px -1px 3px oklch(1 0 0 / 0.5); }
.ed-fh { display: flex; align-items: center; justify-content: space-between; }
.ed-lbl { font-size: 13px; font-weight: 700; color: var(--foreground); }
.ed-tag { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 6px; background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.ed-ov { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: oklch(0.55 0.03 258 / 0.05); }
.ed-ovl { font-size: 10px; font-weight: 800; color: var(--muted-foreground); text-transform: uppercase; }
.ed-ovv { flex: 1; font-size: 12px; color: var(--muted-foreground); text-decoration: line-through; word-break: break-all; }
.ed-n { font-size: 11px; font-weight: 600; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }

/* Qual cards (in-dialog compact) */
.qc { position: relative; display: flex; flex-direction: column; padding: 14px 16px; margin-bottom: 10px; border-radius: 14px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: 3px 3px 8px oklch(0.55 0.03 258 / 0.07), -2px -2px 6px oklch(1 0 0 / 0.8), inset 0 1px 0 oklch(1 0 0 / 0.6); transition: transform .15s; }
.qc:hover { transform: translateY(-1px); }
.qc-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qc-hl { display: flex; align-items: center; gap: 6px; min-width: 0; }
.qc-dot { width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent); flex-shrink: 0; font-size: 11px; }
.qc-tp { font-size: 11px; font-weight: 700; color: var(--c); }
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
.qc-tl--lt { font-size: 11px; font-weight: 600; color: var(--muted-foreground); }
.qc-empty { text-align: center; padding: 40px 20px; color: var(--muted-foreground); }
.qc-empty p { margin: 8px 0 0; font-size: 13px; font-weight: 700; }

/* Contact table */
.ct-cell { display: flex; align-items: center; gap: 8px; }
.ct-av { background: var(--brand); font-size: 12px; }
.ct-nm { font-weight: 700; font-size: 13px; color: var(--foreground); }

/* Transition */
.dlg-enter-active, .dlg-leave-active { transition: opacity .22s; }
.dlg-enter-active .dlg-panel, .dlg-leave-active .dlg-panel { transition: transform .26s cubic-bezier(.22,.61,.36,1), opacity .22s; }
.dlg-enter-from, .dlg-leave-to { opacity: 0; }
.dlg-enter-from .dlg-panel, .dlg-leave-to .dlg-panel { transform: scale(.96) translateY(12px); opacity: 0; }

@media (max-width: 768px) { .cr-list { margin-top: 12px; } }
@media (prefers-reduced-motion: reduce) { .cr-card, .cr-wdot, .dlg-x { transition: none !important; animation: none !important; } }
</style>

<style>
/* Unscoped transition classes for Teleported panels */
.qdlg-enter-active, .qdlg-leave-active { transition: opacity .22s; }
.qdlg-enter-active .qpn, .qdlg-leave-active .qpn { transition: transform .26s cubic-bezier(.22,.61,.36,1), opacity .22s; }
.qdlg-enter-from, .qdlg-leave-to { opacity: 0; }
.qdlg-enter-from .qpn, .qdlg-leave-to .qpn { transform: scale(.96) translateY(12px); opacity: 0; }
.qfade-enter-active, .qfade-leave-active { transition: opacity .2s; }
.qfade-enter-from, .qfade-leave-to { opacity: 0; }

.cdlg-enter-active, .cdlg-leave-active { transition: opacity .22s; }
.cdlg-enter-active .cpn, .cdlg-leave-active .cpn { transition: transform .26s cubic-bezier(.22,.61,.36,1), opacity .22s; }
.cdlg-enter-from, .cdlg-leave-to { opacity: 0; }
.cdlg-enter-from .cpn, .cdlg-leave-to .cpn { transform: scale(.96) translateY(12px); opacity: 0; }

/* Qual add panel unscoped */
.qov { position: fixed; inset: 0; z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.qpn { position: relative; width: 520px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.qpn-h { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.qpn-hl { display: flex; align-items: center; gap: 14px; min-width: 0; }
.qpn-hi { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.qpn-h h2 { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); }
.qpn-h p { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.qpn-x { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.qpn-x:hover { color: var(--brand); transform: translateY(-1px); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.qpn-b { flex: 1; overflow-y: auto; padding: 18px 26px; }
.qpn-s { margin-bottom: 18px; }
.qpn-s:last-of-type { margin-bottom: 0; }
.qpn-sl { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 12px; }
.qpn-sl i { color: var(--danger); font-style: normal; font-weight: 900; }
.qpn-sd { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.qpn-r { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.qpn-f { display: flex; flex-direction: column; gap: 7px; position: relative; }
.qpn-f label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.qpn-f label i { font-style: normal; color: var(--danger); margin-left: 2px; }
.qpn-l2 { color: var(--muted-foreground); font-weight: 600 !important; }
.qpn-iw { position: relative; }
.qpn-ct { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 600; color: var(--muted-foreground); font-variant-numeric: tabular-nums; pointer-events: none; }
.qpn-inp { width: 100%; height: 42px; padding: 0 14px; font-size: 14px; color: var(--ink); font-family: inherit; background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; box-sizing: border-box; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
select.qpn-inp { padding: 0 36px 0 14px; appearance: none; cursor: pointer; }
.qpn-inp:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.qpn-ar { position: absolute; right: 14px; bottom: 14px; color: var(--muted-foreground); pointer-events: none; }
.qpn-up { position: relative; }
.qpn-ud { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 20px 22px; border-radius: 10px; text-align: center; background: var(--surface); box-shadow: inset 1px 1px 3px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.6); }
.qpn-udi { color: var(--muted-foreground); margin-bottom: 2px; transition: color .15s; }
.qpn-ud:hover .qpn-udi { color: var(--brand); }
.qpn-udt { font-size: 13px; font-weight: 600; color: var(--foreground); margin: 0; }
.qpn-udh { font-size: 11px; color: var(--muted-foreground); margin: 0; }
.qpn-ub { display: inline-flex; align-items: center; gap: 7px; margin-top: 6px; padding: 9px 20px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); font-family: inherit; }
.qpn-ub:hover { background: var(--brand-deep); transform: translateY(-1px); }
.qpn-ub:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.qpn-uf { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.06), -1px -1px 1px oklch(1 0 0 / 0.7); }
.qpn-ufi { width: 38px; height: 38px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 12%, transparent); display: flex; align-items: center; justify-content: center; color: var(--brand); flex-shrink: 0; }
.qpn-ufn { flex: 1; min-width: 0; }
.qpn-ufn1 { display: block; font-size: 13px; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpn-ufn2 { display: block; font-size: 11px; color: var(--muted-foreground); margin-top: 1px; }
.qpn-ur { background: none; border: none; font-size: 12px; font-weight: 600; color: var(--brand); cursor: pointer; font-family: inherit; padding: 0; }
.qpn-upb { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: var(--hairline); border-radius: 0 0 10px 10px; overflow: hidden; }
.qpn-upbf { height: 100%; background: var(--brand); transition: width .3s; }
.qpn-ft { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.qpn-h2 { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.qpn-h2.ok { color: var(--success); }
.qpn-fa { display: flex; gap: 10px; flex-shrink: 0; }
.qpn-bc { padding: 10px 20px; border-radius: 9px; border: none; background: var(--surface); color: var(--foreground); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.qpn-bc:hover { color: var(--brand); transform: translateY(-1px); }
.qpn-bs { display: inline-flex; align-items: center; gap: 6px; padding: 10px 22px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); }
.qpn-bs:disabled { opacity: .55; cursor: not-allowed; }
.qpn-bs:not(:disabled):hover { background: var(--brand-deep); transform: translateY(-1px); }

/* Contact panel unscoped */
.cov { position: fixed; inset: 0; z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.cpn { position: relative; width: 460px; max-width: 100%; max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }
.cpn-h { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.cpn-hl { display: flex; align-items: center; gap: 14px; min-width: 0; }
.cpn-hi { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.cpn-h h2 { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); }
.cpn-h p { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.cpn-x { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.cpn-x:hover { color: var(--brand); transform: translateY(-1px); }
.cpn-b { flex: 1; overflow-y: auto; padding: 18px 26px; }
.cpn-s { margin-bottom: 4px; }
.cpn-sl { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 12px; }
.cpn-sd { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.cpn-r { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.cpn-f { display: flex; flex-direction: column; gap: 7px; }
.cpn-f label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.cpn-f label i { font-style: normal; color: var(--danger); margin-left: 2px; }
.cpn-l2 { color: var(--muted-foreground); font-weight: 600 !important; }
.cpn-f--tg { flex-direction: row; align-items: center; justify-content: space-between; }
.cpn-f--tg label { margin-bottom: 0; }
.cpn-inp { width: 100%; height: 42px; padding: 0 14px; font-size: 14px; color: var(--ink); font-family: inherit; background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; box-sizing: border-box; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.cpn-inp:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.cpn-tg { position: relative; width: 44px; height: 26px; border-radius: 13px; border: none; background: oklch(0.94 0.01 258); cursor: pointer; padding: 0; flex-shrink: 0; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.7); }
.cpn-tg.on { background: var(--brand); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.25), 2px 2px 5px oklch(0.4 0.1 258 / 0.25); }
.cpn-tgk { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 1px 1px 3px oklch(0.55 0.03 258 / 0.25); transition: transform .2s cubic-bezier(.22,.61,.36,1); }
.cpn-tg.on .cpn-tgk { transform: translateX(18px); }
.cpn-ft { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.cpn-h2 { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.cpn-h2.ok { color: var(--success); }
.cpn-fa { display: flex; gap: 10px; flex-shrink: 0; }
.cpn-bc { padding: 10px 20px; border-radius: 9px; border: none; background: var(--surface); color: var(--foreground); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); }
.cpn-bc:hover { color: var(--brand); transform: translateY(-1px); }
.cpn-bs { display: inline-flex; align-items: center; gap: 6px; padding: 10px 22px; border-radius: 9px; border: none; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5); }
.cpn-bs:disabled { opacity: .55; cursor: not-allowed; }
.cpn-bs:not(:disabled):hover { background: var(--brand-deep); transform: translateY(-1px); }
</style>
