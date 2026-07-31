<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Trophy, Check, Clock } from '@element-plus/icons-vue'
import SpPageHero from '@/components/SpPageHero.vue'
import dayjs from 'dayjs'
import { awardLetterApi } from '@/api/awardLetter'

interface AwardLetterDelivery {
  id: string
  projectId: string
  supplierName: string
  content: { winnerName?: string; winnerPrice?: string; projectName?: string } | null
  letterAssetId: string | null
  deliveredAt: string | null
  receivedAt: string | null
  signedAt: string | null
  signedBy: string | null
  createdAt: string
}

const letters = ref<AwardLetterDelivery[]>([])
const loading = ref(true)
const signing = ref<string | null>(null)

async function fetchLetters() {
  loading.value = true
  try {
    const res = await awardLetterApi.list()
    letters.value = res.data
  } catch {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function handleSign(id: string) {
  signing.value = id
  try {
    await awardLetterApi.sign(id)
    ElMessage.success('签收成功')
    await fetchLetters()
  } catch {
    ElMessage.error('签收失败，请重试')
  } finally {
    signing.value = null
  }
}

async function handleView(letter: AwardLetterDelivery) {
  if (!letter.receivedAt) {
    try { await awardLetterApi.markReceived(letter.id) } catch {}
  }
}

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—'
}

onMounted(fetchLetters)
</script>

<template>
  <div>
    <SpPageHero title="中标通知书" subtitle="查收并签收中标通知书" :icon="Trophy" />

    <div class="mx-auto max-w-4xl p-6">
      <el-empty v-if="!loading && letters.length === 0" description="暂无中标通知书" />

      <div v-else class="space-y-4">
        <el-card
          v-for="letter in letters"
          :key="letter.id"
          shadow="hover"
          @click="handleView(letter)"
        >
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <el-icon :size="18" color="#059669"><Trophy /></el-icon>
                <span class="font-bold">{{ letter.content?.projectName || '中标通知书' }}</span>
              </div>
              <el-tag v-if="letter.signedAt" type="success" :icon="Check">已签收</el-tag>
              <el-tag v-else-if="letter.deliveredAt" type="warning" :icon="Clock">待签收</el-tag>
              <el-tag v-else type="info">待推送</el-tag>
            </div>
          </template>

          <div class="space-y-2 text-sm text-gray-600">
            <div v-if="letter.content?.winnerName">
              <span class="text-gray-400">中标单位：</span>{{ letter.content.winnerName }}
            </div>
            <div v-if="letter.content?.winnerPrice">
              <span class="text-gray-400">中标金额：</span>{{ letter.content.winnerPrice }}
            </div>
            <div>
              <span class="text-gray-400">推送时间：</span>{{ formatTime(letter.deliveredAt) }}
            </div>
            <div v-if="letter.signedAt">
              <span class="text-gray-400">签收时间：</span>{{ formatTime(letter.signedAt) }}
            </div>
          </div>

          <div v-if="!letter.signedAt && letter.deliveredAt" class="mt-4 flex justify-end">
            <el-button
              type="primary"
              :icon="Check"
              :loading="signing === letter.id"
              @click.stop="handleSign(letter.id)"
            >
              签收确认
            </el-button>
          </div>

          <div v-if="letter.signedAt" class="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <el-icon><Check /></el-icon>
            <span>已于 {{ formatTime(letter.signedAt) }} 签收确认</span>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
