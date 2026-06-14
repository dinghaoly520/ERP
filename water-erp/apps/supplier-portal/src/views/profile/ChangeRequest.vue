<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const supplierStore = useSupplierStore(); const loading = ref(true); const dialogVisible = ref(false); const dialogLoading = ref(false)
const form = ref({fieldName:'',fieldLabel:'',newValue:'',reason:''})
const changeableFields = [{value:'name',label:'企业名称'},{value:'legalPerson',label:'法定代表人'},{value:'registeredAddress',label:'注册地址'},{value:'businessScope',label:'经营范围'},{value:'enterpriseType',label:'企业类型'}]
onMounted(async () => { try { await supplierStore.fetchChangeRecords() } finally { loading.value = false } })
function openDialog() { form.value = {fieldName:'',fieldLabel:'',newValue:'',reason:''}; dialogVisible.value = true }
function onFieldChange(val:string) { const f = changeableFields.find(x=>x.value===val); form.value.fieldLabel = f?.label||'' }
async function handleSubmit() { if (!form.value.fieldName||!form.value.newValue) { ElMessage.warning('请填写完整信息'); return }; dialogLoading.value = true; try { await supplierStore.createChangeRequest(form.value); ElMessage.success('变更申请已提交'); dialogVisible.value = false } catch { ElMessage.error('提交失败') } finally { dialogLoading.value = false } }
const statusMap: Record<string,{label:string;cls:string}> = {PENDING:{label:'待审核',cls:'pending'},APPROVED:{label:'已通过',cls:'approved'},REJECTED:{label:'已拒绝',cls:'rejected'}}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow blue"><el-icon :size="13"><EditPen /></el-icon>Change Requests</div>
          <h1 class="sp-modern-title">信息变更</h1>
          <p class="sp-modern-desc">申请修改企业信息，提交后需等待管理员审核。</p>
        </div>
        <div class="sp-page-hero-actions"><el-button type="primary" @click="openDialog"><el-icon><EditPen /></el-icon>申请变更</el-button></div>
      </div>
    </div>

    <div v-if="supplierStore.changeRecords.length>0" class="detail-card" style="overflow:hidden;padding:0">
      <el-table :data="supplierStore.changeRecords" stripe style="width:100%">
        <el-table-column label="变更字段" prop="fieldLabel" width="140" />
        <el-table-column label="原值" prop="oldValue" min-width="160"><template #default="{row}">{{ row.oldValue||'-' }}</template></el-table-column>
        <el-table-column label="新值" prop="newValue" min-width="160"><template #default="{row}"><span style="color:var(--sp-primary);font-weight:600">{{ row.newValue }}</span></template></el-table-column>
        <el-table-column label="变更原因" prop="reason" min-width="160"><template #default="{row}">{{ row.reason||'-' }}</template></el-table-column>
        <el-table-column label="状态" width="110" align="center"><template #default="{row}"><span class="sp-status" :class="statusMap[row.status]?.cls||'pending'">{{ statusMap[row.status]?.label||row.status }}</span></template></el-table-column>
        <el-table-column label="申请时间" width="160"><template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template></el-table-column>
      </el-table>
    </div>

    <div v-else class="detail-card" style="text-align:center;padding:64px"><el-icon :size="32" color="var(--sp-gray-300)"><EditPen /></el-icon><p style="margin-top:12px;font-size:15px;font-weight:700;color:var(--sp-gray-500)">暂无变更记录</p><p style="margin-top:4px;font-size:13px;color:var(--sp-gray-400)">如需修改企业信息，请点击上方按钮申请变更</p></div>

    <el-dialog v-model="dialogVisible" title="申请信息变更" width="520px" destroy-on-close>
      <el-form :model="form" label-width="90px" size="large">
        <el-form-item label="变更字段" required><el-select v-model="form.fieldName" placeholder="请选择要变更的字段" style="width:100%" @change="onFieldChange"><el-option v-for="f in changeableFields" :key="f.value" :label="f.label" :value="f.value" /></el-select></el-form-item>
        <el-form-item label="新值" required><el-input v-model="form.newValue" placeholder="请输入新的值" /></el-form-item>
        <el-form-item label="变更原因"><el-input v-model="form.reason" type="textarea" :rows="3" placeholder="请简要说明变更原因" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="dialogLoading" @click="handleSubmit">提交申请</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 24px; }
</style>
