<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { createDialogLeaveGuard } from '@/composables'

const supplierStore = useSupplierStore(); const loading = ref(true); const error = ref(false); const dialogVisible = ref(false); const dialogLoading = ref(false); const uploading = ref(false); const qualUploadProgress = ref<number|null>(null); const uploadedMeta = ref<FileAssetResponse|null>(null); const form = ref({type:'',name:'',fileUrl:'',validFrom:'',validTo:''}); const formDirty = ref(false); const dialogGuard = createDialogLeaveGuard(formDirty); function markDirty(){formDirty.value=true}
onMounted(async () => { try { await supplierStore.fetchQualifications() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await supplierStore.fetchQualifications() } catch { error.value = true } finally { loading.value = false } }
const qualTypes = ['营业执照','资质证书','安全生产许可证','质量管理体系认证','环境管理体系认证','职业健康安全管理体系认证','其他']

function openAdd() { form.value = {type:'',name:'',fileUrl:'',validFrom:'',validTo:''}; uploadedMeta.value = null; formDirty.value = false; dialogVisible.value = true }
async function customUpload(options:any) { const file = options.file as File; if (file.size>50*1024*1024) { ElMessage.error('文件不能超过50MB'); options.onError(new Error('FILE_TOO_LARGE')); return }; uploading.value = true; qualUploadProgress.value = 0; try { const res = await uploadFile(file,'qualification',(pct)=>{qualUploadProgress.value = pct}); form.value.fileUrl = res.url; uploadedMeta.value = res; options.onSuccess(res); ElMessage.success('文件上传成功'); formDirty.value = true } catch (e:any) { options.onError(e) } finally { uploading.value = false; qualUploadProgress.value = null } }
function formatSize(bytes:number):string { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB` }
async function handleAdd() { if (!form.value.type||!form.value.name) { ElMessage.warning('请填写资质类型和名称'); return }; if (!uploadedMeta.value||!form.value.fileUrl) { ElMessage.warning('请先上传资质文件'); return }; dialogLoading.value = true; try { await supplierStore.addQualification(form.value); ElMessage.success('资质材料添加成功'); dialogVisible.value = false; formDirty.value = false } catch { ElMessage.error('添加失败') } finally { dialogLoading.value = false } }
async function handleDelete(id:string) { await ElMessageBox.confirm('确定要删除此资质材料吗？','提示',{type:'warning'}); try { await supplierStore.deleteQualification(id); ElMessage.success('已删除') } catch { ElMessage.error('删除失败') } }
function getStatusInfo(q:any) { if (!q.validTo) return {label:'长期有效',cls:'approved'}; const diff = (new Date(q.validTo).getTime()-Date.now())/86400000; if (diff<0) return {label:'已过期',cls:'rejected'}; if (diff<30) return {label:'即将过期',cls:'pending'}; return {label:'有效',cls:'approved'} }
const healthSummary = computed(() => { const quals = supplierStore.qualifications; const now = Date.now(); let valid=0,expiring=0,expired=0,longTerm=0; quals.forEach((q:any)=>{ if(!q.validTo){longTerm++;return} const diff=(new Date(q.validTo).getTime()-now)/86400000; if(diff<0)expired++; else if(diff<30)expiring++; else valid++ }); const total=quals.length; const healthScore=total>0?Math.round(((valid+longTerm)/total)*100):0; return {total,valid,expiring,expired,longTerm,healthScore} })
const healthTone = computed(() => { const s=healthSummary.value; if(s.expired>0)return {color:'#dc2626',bg:'#fef2f2',label:'有证照过期',icon:'WarningFilled'}; if(s.expiring>0)return {color:'#d97706',bg:'#fffbeb',label:'有证照即将过期',icon:'Clock'}; return {color:'#059669',bg:'#ecfdf5',label:'证照状态良好',icon:'CircleCheckFilled'} })
const healthRingDash = computed(() => { const pct=healthSummary.value.healthScore; const c=2*Math.PI*34; const d=c*pct/100; return `${d} ${c-d}` })
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">资质管理</h1>
          <p class="sp-modern-desc">管理企业资质材料，确保证照在有效期内。过期材料将影响投标资格。</p>
        </div>
        <div class="sp-page-hero-actions"><el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon>添加资质</el-button></div>
      </div>
    </div>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
      <div v-if="healthSummary.total>0" class="qual-health" :style="{borderColor:healthTone.color}">
        <div class="qual-health-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--sp-gray-100)" stroke-width="6" />
            <circle cx="40" cy="40" r="34" fill="none" :stroke="healthTone.color" stroke-width="6" stroke-linecap="round" :stroke-dasharray="healthRingDash" transform="rotate(-90 40 40)" />
          </svg>
          <span class="qual-health-score">{{ healthSummary.healthScore }}%</span>
        </div>
        <div class="qual-health-info">
          <div class="qual-health-counts">
            <span class="qual-health-count valid">{{ healthSummary.valid }} 有效</span>
            <span class="qual-health-count long-term">{{ healthSummary.longTerm }} 长期</span>
            <span class="qual-health-count expiring">{{ healthSummary.expiring }} 即将过期</span>
            <span class="qual-health-count expired">{{ healthSummary.expired }} 已过期</span>
          </div>
          <p class="qual-health-hint">{{ healthTone.label }}</p>
        </div>
      </div>
      <el-row :gutter="16" v-if="supplierStore.qualifications.length>0">
        <el-col :xs="24" :sm="12" :lg="8" v-for="q in supplierStore.qualifications" :key="q.id">
          <div class="sp-card qual-card">
            <div class="qual-card-top"><el-tag effect="plain" size="small">{{ q.type }}</el-tag><span class="sp-status" :class="getStatusInfo(q).cls">{{ getStatusInfo(q).label }}</span></div>
            <h3 class="qual-name">{{ q.name }}</h3>
            <div class="qual-meta">
              <div v-if="q.validFrom" class="qual-date"><el-icon><Calendar /></el-icon>{{ dayjs(q.validFrom).format('YYYY-MM-DD') }} ~ {{ q.validTo ? dayjs(q.validTo).format('YYYY-MM-DD') : '长期' }}</div>
              <div class="qual-file"><el-icon><Document /></el-icon><a :href="q.fileUrl" target="_blank" rel="noopener" class="qual-file-link">查看附件文件</a></div>
            </div>
            <div class="qual-actions"><el-button text type="primary" size="small">查看文件</el-button><el-button text type="danger" size="small" @click="handleDelete(q.id)">删除</el-button></div>
          </div>
        </el-col>
      </el-row>
      <div v-else class="detail-card" style="text-align:center;padding:64px"><el-icon :size="32" color="var(--sp-gray-300)"><Folder /></el-icon><p style="margin-top:12px;font-size:15px;font-weight:700;color:var(--sp-gray-500)">暂无资质材料</p><p style="margin-top:4px;font-size:13px;color:var(--sp-gray-400)">点击上方按钮添加您的企业资质证照</p></div>
    </template>

    <el-dialog v-model="dialogVisible" title="添加资质材料" width="520px" destroy-on-close :before-close="dialogGuard">
      <el-form :model="form" label-width="100px" size="large">
        <el-form-item label="资质类型" required><el-select v-model="form.type" placeholder="请选择资质类型" style="width:100%" @change="markDirty"><el-option v-for="t in qualTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item>
        <el-form-item label="资质名称" required><el-input v-model="form.name" placeholder="请输入资质名称" @input="markDirty" /></el-form-item>
        <el-form-item label="有效期起"><el-date-picker v-model="form.validFrom" type="date" placeholder="选择开始日期" style="width:100%" value-format="YYYY-MM-DD" @change="markDirty" /></el-form-item>
        <el-form-item label="有效期止"><el-date-picker v-model="form.validTo" type="date" placeholder="选择结束日期（不填为长期有效）" style="width:100%" value-format="YYYY-MM-DD" @change="markDirty" /></el-form-item>
        <el-form-item label="上传文件" required>
          <el-upload :show-file-list="false" :http-request="customUpload" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"><el-button type="primary" plain :icon="UploadFilled" :loading="uploading">{{ uploadedMeta?'重新选择文件':'选择文件' }}</el-button></el-upload>
          <el-progress v-if="qualUploadProgress!==null" :percentage="qualUploadProgress" :stroke-width="6" style="width:200px;margin-top:8px" />
          <div v-if="uploadedMeta" class="upload-meta"><el-icon><Document /></el-icon><span>{{ uploadedMeta.originalName }}</span><span class="upload-meta-size">{{ formatSize(uploadedMeta.size) }}</span></div>
          <span v-else class="upload-hint">支持 PDF、图片、Office、ZIP，≤50MB</span>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="dialogLoading" :disabled="!uploadedMeta" @click="handleAdd">确认添加</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.qual-card { display: flex; flex-direction: column; min-height: 190px; }
.qual-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.qual-name { font-size: 15px; font-weight: 700; color: var(--sp-gray-900); margin-bottom: 14px; flex: 1; }
.qual-meta { font-size: 12px; color: var(--sp-gray-500); display: flex; flex-direction: column; gap: 6px; }
.qual-date { display: flex; align-items: center; gap: 4px; }
.qual-file { display: flex; align-items: center; gap: 4px; }
.qual-file-link { color: var(--sp-primary); text-decoration: none; }
.qual-file-link:hover { text-decoration: underline; }
.qual-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 14px; border-top: 1px solid rgba(0,0,0,0.05); }
.upload-meta { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; color: var(--sp-gray-500); }
.upload-meta-size { color: var(--sp-gray-400); }
.upload-hint { display: block; margin-top: 6px; color: var(--sp-gray-400); font-size: 13px; }
.detail-card { position: relative; background: rgba(255,255,255,0.62); backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15); border: 1px solid rgba(255,255,255,0.50); border-radius: var(--sp-radius-md); padding: 24px; }
.detail-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.36; border-radius: inherit; background-image: radial-gradient(ellipse at 10% 6%, rgba(96,165,250,0.16), transparent 55%), radial-gradient(ellipse at 85% 12%, rgba(56,189,248,0.10), transparent 55%), radial-gradient(ellipse at 38% 90%, rgba(6,78,162,0.05), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.detail-card > * { position: relative; z-index: 1; }
.qual-health { position: relative; display: flex; align-items: center; gap: 20px; padding: 16px 20px; border: 1px solid rgba(255,255,255,0.50); border-left: 4px solid; border-radius: var(--sp-radius-md); background: rgba(255,255,255,0.62); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); margin-bottom: 16px; }
.qual-health::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.32; border-radius: inherit; background-image: radial-gradient(ellipse at 14% 6%, rgba(96,165,250,0.12), transparent 55%), radial-gradient(ellipse at 80% 10%, rgba(56,189,248,0.08), transparent 55%), radial-gradient(ellipse at 36% 90%, rgba(6,78,162,0.04), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.qual-health > * { position: relative; z-index: 1; }
.qual-health-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
.qual-health-score { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; color: var(--sp-gray-900); }
.qual-health-info { flex: 1; min-width: 0; }
.qual-health-counts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.qual-health-count { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 4px; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.qual-health-count.valid { background: rgba(236,253,245,0.70); color: #059669; }
.qual-health-count.long-term { background: rgba(239,246,255,0.70); color: #064ea2; }
.qual-health-count.expiring { background: rgba(255,251,235,0.70); color: #d97706; }
.qual-health-count.expired { background: rgba(254,242,242,0.70); color: #dc2626; }
.qual-health-hint { font-size: 13px; color: var(--sp-gray-500); margin: 0; }
</style>
