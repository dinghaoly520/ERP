<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { catalogApi } from '@/api/catalog'

/**
 * 目录供货申请弹窗，统一处理：
 *  - NEW_ITEM      新增品类申请
 *  - JOIN_EXISTING 加入已有品类供货
 *  - UPDATE_QUOTE  改报价（须已有准入关系）
 *  - edit          重新提交（RETURNED 补正 / COUNTERED 再报价）
 */
const props = defineProps<{
  modelValue: boolean
  mode: 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE' | 'edit'
  item?: any         // JOIN_EXISTING / UPDATE_QUOTE 的目标目录条目（脱敏）
  application?: any  // edit 模式下要编辑的申请
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; success: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const titleMap: Record<string, string> = {
  NEW_ITEM: '新增采购品类申请',
  JOIN_EXISTING: '申请供货',
  UPDATE_QUOTE: '申请改报价',
  edit: '编辑并重新提交',
}
const title = computed(() => titleMap[props.mode])

// 品类树（NEW_ITEM 选择分类用）
const categoryTree = ref<{ group: string; categories: string[] }[]>([])
const groupOptions = computed(() => categoryTree.value.map(c => c.group))
function categoriesOf(group: string) {
  return categoryTree.value.find(c => c.group === group)?.categories || []
}

const submitting = ref(false)
const formDirty = ref(false)
const form = ref<any>({})

function markDirty() { formDirty.value = true }

async function handleBeforeClose(done: () => void) {
  if (formDirty.value) {
    try {
      await ElMessageBox.confirm('有未保存的填写内容，确定放弃吗？', '提示', {
        confirmButtonText: '确定放弃', cancelButtonText: '继续编辑', type: 'warning',
      })
    } catch { return }
  }
  done()
}

function resetForm() {
  if (props.mode === 'edit' && props.application) {
    const a = props.application
    form.value = {
      proposedName: a.proposedName,
      proposedSpec: a.proposedSpec,
      proposedCategory: a.proposedCategory,
      proposedGroup: a.proposedGroup,
      proposedUnit: a.proposedUnit,
      quotedPrice: a.quotedPrice,
      deliveryPeriod: a.deliveryPeriod,
      region: a.region,
      minOrder: a.minOrder,
      taxIncluded: a.taxIncluded ?? true,
      freightIncluded: a.freightIncluded ?? false,
      qualificationNote: a.qualificationNote,
    }
  } else if (props.mode === 'UPDATE_QUOTE' && props.item) {
    form.value = {
      quotedPrice: undefined,
      deliveryPeriod: '',
      region: '',
      minOrder: '',
      taxIncluded: true,
      freightIncluded: false,
      qualificationNote: '',
    }
  } else {
    form.value = {
      proposedName: '', proposedSpec: '', proposedCategory: '', proposedGroup: '', proposedUnit: '',
      quotedPrice: undefined,
      deliveryPeriod: '', region: '', minOrder: '',
      taxIncluded: true, freightIncluded: false,
      qualificationNote: '',
    }
  }
}

watch(() => props.modelValue, async (v) => {
  if (v) {
    resetForm()
    if (props.mode === 'NEW_ITEM' && categoryTree.value.length === 0) {
      try { categoryTree.value = await catalogApi.listCategories() } catch { /* ignore */ }
    }
  }
})

const isNewItem = computed(() => props.mode === 'NEW_ITEM' || (props.mode === 'edit' && props.application?.type === 'NEW_ITEM'))

async function handleSubmit() {
  // 基本校验
  if (form.value.quotedPrice == null || Number(form.value.quotedPrice) <= 0) {
    ElMessage.warning('请填写有效报价'); return
  }
  if (isNewItem.value) {
    if (!form.value.proposedName?.trim()) { ElMessage.warning('请填写物资名称'); return }
    if (!form.value.proposedGroup) { ElMessage.warning('请选择组别'); return }
    if (!form.value.proposedCategory) { ElMessage.warning('请选择分类'); return }
    if (!form.value.proposedUnit?.trim()) { ElMessage.warning('请填写单位'); return }
  }

  // Confirm price changes
  if (props.mode === 'UPDATE_QUOTE') {
    try {
      await ElMessageBox.confirm(
        `确认将报价修改为 ¥${Number(form.value.quotedPrice).toFixed(2)}？`,
        '确认改报价',
        { confirmButtonText: '确认修改', cancelButtonText: '取消', type: 'warning' }
      )
    } catch { return }
  }

  submitting.value = true
  try {
    const payload: any = {
      quotedPrice: Number(form.value.quotedPrice),
      deliveryPeriod: form.value.deliveryPeriod || undefined,
      region: form.value.region || undefined,
      minOrder: form.value.minOrder || undefined,
      taxIncluded: form.value.taxIncluded,
      freightIncluded: form.value.freightIncluded,
      qualificationNote: form.value.qualificationNote || undefined,
    }
    if (isNewItem.value) {
      payload.proposedName = form.value.proposedName.trim()
      payload.proposedSpec = form.value.proposedSpec?.trim() || undefined
      payload.proposedCategory = form.value.proposedCategory
      payload.proposedGroup = form.value.proposedGroup
      payload.proposedUnit = form.value.proposedUnit.trim()
    }

    if (props.mode === 'edit') {
      await catalogApi.updateApplication(props.application.id, { ...payload, type: props.application.type })
      ElMessage.success('已重新提交申请')
    } else {
      await catalogApi.createApplication({ type: props.mode, catalogItemId: props.item?.id, ...payload })
      ElMessage.success('申请已提交，等待管理员审核')
    }
    formDirty.value = false
    visible.value = false
    emit('success')
  } catch {
    /* interceptor 已提示 */
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="560px" destroy-on-close :before-close="handleBeforeClose">
    <!-- 目标物资信息（JOIN/UPDATE）-->
    <el-alert v-if="item && mode !== 'NEW_ITEM' && mode !== 'edit'" type="info" :closable="false" style="margin-bottom: 16px;">
      <template #title>
        <span style="font-weight: 700;">{{ item.name }}</span>
        <span style="color: var(--sp-gray-400); margin-left: 8px;">{{ item.code }} · {{ item.specification }} · {{ item.unit }}</span>
      </template>
    </el-alert>
    <el-alert v-if="mode === 'edit' && application?.catalogItem" type="info" :closable="false" style="margin-bottom: 16px;">
      <template #title>
        <span style="font-weight: 700;">{{ application.catalogItem.name }}</span>
        <span style="color: var(--sp-gray-400); margin-left: 8px;">{{ application.catalogItem.code }}</span>
      </template>
    </el-alert>
    <el-alert v-if="mode === 'edit' && application?.status === 'COUNTERED' && application.counterPrice" type="warning" :closable="false" style="margin-bottom: 16px;">
      <template #title>管理员议价反报价 ¥{{ application.counterPrice }}，您可直接修改报价后重新提交。</template>
    </el-alert>

    <el-form :model="form" label-width="96px" label-position="right">
      <template v-if="isNewItem">
        <el-form-item label="物资名称" required>
          <el-input v-model="form.proposedName" placeholder="如：玻璃钢夹砂管" maxlength="60" />
        </el-form-item>
        <el-form-item label="规格型号">
          <el-input v-model="form.proposedSpec" placeholder="如：DN500，SN10" maxlength="120" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="组别" required>
              <el-select v-model="form.proposedGroup" placeholder="选择组别" style="width: 100%;" @change="form.proposedCategory = ''">
                <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类" required>
              <el-select v-model="form.proposedCategory" placeholder="选择分类" style="width: 100%;" :disabled="!form.proposedGroup">
                <el-option v-for="c in categoriesOf(form.proposedGroup)" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="单位" required>
          <el-input v-model="form.proposedUnit" placeholder="如：米 / 吨 / 套" maxlength="10" style="width: 160px;" />
        </el-form-item>
      </template>

      <el-form-item :label="mode === 'UPDATE_QUOTE' ? '新报价' : '报价'" required>
        <el-input-number v-model="form.quotedPrice" :min="0" :precision="2" :step="1" controls-position="right" style="width: 200px;" />
        <span class="form-hint" v-if="item"> / {{ item.unit }}</span>
        <span class="form-hint" v-else-if="form.proposedUnit"> / {{ form.proposedUnit }}</span>
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="交货周期">
            <el-input v-model="form.deliveryPeriod" placeholder="如：7个工作日" maxlength="20" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="适用区域">
            <el-input v-model="form.region" placeholder="如：成都 / 全省" maxlength="20" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="最小起订">
            <el-input v-model="form.minOrder" placeholder="如：1吨 / 50米" maxlength="20" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="含税/运费">
            <el-checkbox v-model="form.taxIncluded">含税</el-checkbox>
            <el-checkbox v-model="form.freightIncluded">含运费</el-checkbox>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="资质说明">
        <el-input v-model="form.qualificationNote" type="textarea" :rows="3" placeholder="资质优势、代理授权、库存产能等，便于管理员审核" maxlength="300" show-word-limit />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ mode === 'edit' ? '重新提交' : '提交申请' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint { color: var(--sp-gray-400); font-size: 13px; margin-left: 6px; }
</style>
