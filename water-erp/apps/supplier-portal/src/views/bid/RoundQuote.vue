<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Coin, Lock } from '@element-plus/icons-vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { bidApi } from '@/api/bid'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string

interface Round {
  id: string; roundNo: number; roundType: string; status: string; deadline: string | null
}
interface Quote { id: string; bidSupplierId: string; quotePrice: string; status: string }

const loading = ref(true)
const rounds = ref<Round[]>([])
const publishedQuotes = ref<Record<string, Quote[]>>({})
const myBidSupplierId = ref<string>('')
const quotePrice = ref<number | undefined>(undefined)
const submitting = ref(false)

const currentOpenRound = computed(() => rounds.value.find(r => r.status === 'open'))

async function fetchData() {
  loading.value = true
  try {
    const res = await bidApi.listRounds(projectId)
    rounds.value = res as any

    // 获取当前供应商在此项目中的 BidSupplier ID
    try {
      const bsRes = await bidApi.getMyBidSupplier(projectId)
      myBidSupplierId.value = (bsRes as any)?.id ?? ''
    } catch (e) { /* 非项目成员则保持为空 */ }

    // Load published round quotes
    for (const r of rounds.value) {
      if (r.status === 'published' || r.status === 'closed') {
        try {
          const qRes = await bidApi.getRoundQuotes(projectId, r.id)
          publishedQuotes.value[r.id] = qRes as any
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  if (!currentOpenRound.value || !myBidSupplierId.value || quotePrice.value == null) return
  submitting.value = true
  try {
    await bidApi.submitQuote(projectId, currentOpenRound.value.id, {
      bidSupplierId: myBidSupplierId.value,
      quotePrice: quotePrice.value,
    })
    ElMessage.success('报价已提交(密封)')
    quotePrice.value = undefined
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '提交失败')
  } finally {
    submitting.value = false
  }
}

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format('MM-DD HH:mm') : '—'
}

const statusLabels: Record<string, string> = {
  pending: '待开放', open: '报价中', sealed: '已截止', published: '已公布', closed: '已结束',
}
const statusColors: Record<string, string> = {
  pending: '#909399', open: '#409eff', sealed: '#e6a23c', published: '#67c23a', closed: '#909399',
}

onMounted(fetchData)
</script>

<template>
  <div>
    <SpPageHero title="多轮报价" subtitle="密封报价 · 谈判/竞价采购" :icon="Coin" />

    <div class="mx-auto max-w-3xl p-6">
      <div class="mb-4">
        <el-button :icon="ArrowLeft" text @click="router.back()">返回</el-button>
      </div>

      <el-empty v-if="!loading && rounds.length === 0" description="暂无报价轮次" />

      <div v-else class="space-y-4">
        <!-- 当前开放轮次: 报价输入 -->
        <el-card v-if="currentOpenRound" shadow="hover">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-bold">第 {{ currentOpenRound.roundNo }} 轮报价</span>
              <el-tag type="primary">{{ statusLabels[currentOpenRound.status] }}</el-tag>
            </div>
          </template>

          <div v-if="currentOpenRound.deadline" class="mb-4 text-sm text-gray-500">
            截止时间: {{ formatTime(currentOpenRound.deadline) }}
          </div>

          <el-form label-width="100px">
            <el-form-item label="报价(元)">
              <el-input-number
                v-model="quotePrice"
                :min="0"
                :precision="2"
                placeholder="请输入报价金额"
                class="!w-64"
              />
            </el-form-item>
          </el-form>

          <div class="flex justify-end">
            <el-button type="primary" :icon="Lock" :loading="submitting" @click="handleSubmit">
              提交密封报价
            </el-button>
          </div>
        </el-card>

        <!-- 各轮次状态 -->
        <el-card v-for="r in rounds" :key="r.id" shadow="never" class="!border-gray-200">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">第 {{ r.roundNo }} 轮</span>
              <el-tag size="small" :style="{ color: statusColors[r.status], borderColor: statusColors[r.status] }">
                {{ statusLabels[r.status] }}
              </el-tag>
              <span v-if="r.deadline" class="text-xs text-gray-400">截止 {{ formatTime(r.deadline) }}</span>
            </div>
          </div>

          <!-- 已公布轮次: 报价排名 -->
          <div v-if="(r.status === 'published' || r.status === 'closed') && publishedQuotes[r.id]?.length" class="mt-3">
            <div class="overflow-hidden rounded-lg border border-gray-100">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-gray-50 text-xs text-gray-500">
                    <th class="px-3 py-2 text-left font-semibold">排名</th>
                    <th class="px-3 py-2 text-left font-semibold">供应商</th>
                    <th class="px-3 py-2 text-right font-semibold">报价(元)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(q, idx) in publishedQuotes[r.id]" :key="q.id" class="border-t border-gray-100">
                    <td class="px-3 py-2 font-mono font-bold text-blue-600">{{ idx + 1 }}</td>
                    <td class="px-3 py-2">{{ q.bidSupplierId === myBidSupplierId ? '本企业' : '其他供应商' }}</td>
                    <td class="px-3 py-2 text-right font-mono font-semibold">{{ Number(q.quotePrice).toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
