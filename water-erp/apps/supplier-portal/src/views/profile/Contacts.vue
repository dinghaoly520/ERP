<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'

const supplierStore = useSupplierStore()
const loading = ref(true)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const isEdit = ref(false)
const editId = ref('')
const form = ref({ name: '', phone: '', email: '', isPrimary: false })

onMounted(async () => {
  try {
    await supplierStore.fetchContacts()
  } finally {
    loading.value = false
  }
})

function openAdd() {
  isEdit.value = false
  editId.value = ''
  form.value = { name: '', phone: '', email: '', isPrimary: false }
  dialogVisible.value = true
}

function openEdit(c: any) {
  isEdit.value = true
  editId.value = c.id
  form.value = { name: c.name, phone: c.phone, email: c.email || '', isPrimary: c.isPrimary }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.value.name || !form.value.phone) {
    ElMessage.warning('请填写姓名和手机号')
    return
  }
  dialogLoading.value = true
  try {
    if (isEdit.value) {
      await supplierStore.updateContact(editId.value, form.value)
      ElMessage.success('联系人更新成功')
    } else {
      await supplierStore.addContact(form.value)
      ElMessage.success('联系人添加成功')
    }
    dialogVisible.value = false
  } catch {
    ElMessage.error(isEdit.value ? '更新失败' : '添加失败')
  } finally {
    dialogLoading.value = false
  }
}

async function handleDelete(id: string) {
  await ElMessageBox.confirm('确定要删除此联系人吗？', '提示', { type: 'warning' })
  try {
    await supplierStore.deleteContact(id)
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-section-header">
      <div>
        <h1 class="page-title">联系人管理</h1>
        <p class="page-desc">管理您的企业联系人信息</p>
      </div>
      <el-button type="primary" @click="openAdd">
        <el-icon><Plus /></el-icon>添加联系人
      </el-button>
    </div>

    <div class="sp-card" v-if="supplierStore.contacts.length > 0">
      <el-table :data="supplierStore.contacts" stripe>
        <el-table-column label="姓名" prop="name" width="140">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 8px;">
              <el-avatar :size="32" :style="{ background: '#0a5eb8', fontSize: '13px' }">{{ row.name?.charAt(0) }}</el-avatar>
              <span style="font-weight: 600;">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="手机号" prop="phone" width="160" />
        <el-table-column label="邮箱" prop="email">
          <template #default="{ row }">
            <span>{{ row.email || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="主要联系人" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isPrimary ? 'primary' : 'info'" size="small" effect="plain">
              {{ row.isPrimary ? '主要' : '普通' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">👤</div>
        <div class="sp-empty-text">暂无联系人</div>
        <div class="sp-empty-desc">请添加企业联系人信息</div>
      </div>
    </div>

    <!-- Dialog -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑联系人' : '添加联系人'" width="440px" destroy-on-close>
      <el-form :model="form" label-width="90px" size="large">
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input v-model="form.phone" placeholder="请输入手机号" maxlength="11" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="请输入邮箱（选填）" />
        </el-form-item>
        <el-form-item label="主要联系人">
          <el-switch v-model="form.isPrimary" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleSubmit">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>
