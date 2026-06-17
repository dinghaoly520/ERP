<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createDialogLeaveGuard } from '@/composables'

const supplierStore = useSupplierStore(); const loading = ref(true); const error = ref(false); const dialogVisible = ref(false); const dialogLoading = ref(false); const isEdit = ref(false); const editId = ref(''); const form = ref({name:'',phone:'',email:'',isPrimary:false}); const formDirty = ref(false); const dialogGuard = createDialogLeaveGuard(formDirty); function markDirty(){formDirty.value=true}
onMounted(async () => { try { await supplierStore.fetchContacts() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await supplierStore.fetchContacts() } catch { error.value = true } finally { loading.value = false } }
function openAdd() { isEdit.value=false; editId.value=''; form.value = {name:'',phone:'',email:'',isPrimary:false}; formDirty.value=false; dialogVisible.value = true }
function openEdit(c:any) { isEdit.value=true; editId.value=c.id; form.value = {name:c.name,phone:c.phone,email:c.email||'',isPrimary:c.isPrimary}; formDirty.value=false; dialogVisible.value = true }
async function handleSubmit() { if (!form.value.name||!form.value.phone) { ElMessage.warning('请填写姓名和手机号'); return }; if (!/^1[3-9]\d{9}$/.test(form.value.phone)) { ElMessage.warning('请输入正确的11位手机号'); return }; dialogLoading.value = true; try { if (isEdit.value) { await supplierStore.updateContact(editId.value,form.value); ElMessage.success('联系人更新成功') } else { await supplierStore.addContact(form.value); ElMessage.success('联系人添加成功') }; dialogVisible.value = false; formDirty.value = false } catch { ElMessage.error(isEdit.value?'更新失败':'添加失败') } finally { dialogLoading.value = false } }
async function handleDelete(id:string) { await ElMessageBox.confirm('确定要删除此联系人吗？','提示',{type:'warning'}); try { await supplierStore.deleteContact(id); ElMessage.success('已删除') } catch { ElMessage.error('删除失败') } }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">联系人管理</h1>
          <p class="sp-modern-desc">管理您的企业联系人信息，支持添加、编辑和删除。</p>
        </div>
        <div class="sp-page-hero-actions"><el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon>添加联系人</el-button></div>
      </div>
    </div>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div v-else-if="supplierStore.contacts.length>0" class="detail-card" style="overflow:hidden;padding:0">
      <el-table :data="supplierStore.contacts" stripe>
        <el-table-column label="姓名" prop="name" width="160"><template #default="{row}"><div class="contact-name-cell"><el-avatar :size="32" :style="{background:'var(--sp-primary)',fontSize:'13px'}">{{ row.name?.charAt(0) }}</el-avatar><span style="font-weight:700;font-size:14px;color:var(--sp-gray-900)">{{ row.name }}</span></div></template></el-table-column>
        <el-table-column label="手机号" prop="phone" width="160" />
        <el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column>
        <el-table-column label="主要联系人" width="120" align="center"><template #default="{row}"><el-tag :type="row.isPrimary?'primary':'info'" size="small" effect="plain">{{ row.isPrimary?'主要':'普通' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160" align="center"><template #default="{row}"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="handleDelete(row.id)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else class="detail-card" style="text-align:center;padding:64px"><el-icon :size="32" color="var(--sp-gray-300)"><Phone /></el-icon><p style="margin-top:12px;font-size:15px;font-weight:700;color:var(--sp-gray-500)">暂无联系人</p><p style="margin-top:4px;font-size:13px;color:var(--sp-gray-400)">请添加企业联系人信息</p></div>

    <el-dialog v-model="dialogVisible" :title="isEdit?'编辑联系人':'添加联系人'" width="440px" destroy-on-close :before-close="dialogGuard">
      <el-form :model="form" label-width="100px" size="large">
        <el-form-item label="姓名" required><el-input v-model="form.name" placeholder="请输入姓名" @input="markDirty" /></el-form-item>
        <el-form-item label="手机号" required><el-input v-model="form.phone" placeholder="请输入手机号" maxlength="11" @input="markDirty" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" placeholder="请输入邮箱（选填）" @input="markDirty" /></el-form-item>
        <el-form-item label="主要联系人"><el-switch v-model="form.isPrimary" @change="markDirty" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="dialogLoading" @click="handleSubmit">确认</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-card { position: relative; background: rgba(255,255,255,0.62); backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15); border: 1px solid rgba(255,255,255,0.50); border-radius: var(--sp-radius-md); padding: 24px; }
.detail-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.36; border-radius: inherit; background-image: radial-gradient(ellipse at 10% 6%, rgba(96,165,250,0.16), transparent 55%), radial-gradient(ellipse at 85% 12%, rgba(56,189,248,0.10), transparent 55%), radial-gradient(ellipse at 38% 90%, rgba(6,78,162,0.05), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.detail-card > * { position: relative; z-index: 1; }
.contact-name-cell { display: flex; align-items: center; gap: 10px; }
</style>
