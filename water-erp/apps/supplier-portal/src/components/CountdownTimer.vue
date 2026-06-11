<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const props = defineProps<{ deadline: string | Date }>()

const now = ref(Date.now())
let timer: any = null

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => { if (timer) clearInterval(timer) })

const diff = computed(() => {
  const end = new Date(props.deadline).getTime()
  return end - now.value
})

const isExpired = computed(() => diff.value <= 0)

const display = computed(() => {
  if (isExpired.value) return '已截止'
  const d = diff.value
  const days = Math.floor(d / 86400000)
  const hours = Math.floor((d % 86400000) / 3600000)
  const mins = Math.floor((d % 3600000) / 60000)
  const secs = Math.floor((d % 60000) / 1000)
  if (days > 0) return `${days}天 ${hours}时 ${mins}分`
  if (hours > 0) return `${hours}时 ${mins}分 ${secs}秒`
  return `${mins}分 ${secs}秒`
})

const urgency = computed(() => {
  if (isExpired.value) return 'expired'
  const hours = diff.value / 3600000
  if (hours < 1) return 'critical'
  if (hours < 24) return 'urgent'
  return 'normal'
})
</script>

<template>
  <span class="sp-countdown" :class="urgency">
    <el-icon v-if="urgency === 'expired'"><CircleCloseFilled /></el-icon>
    <el-icon v-else-if="urgency === 'critical'" class="pulse-icon"><Timer /></el-icon>
    <el-icon v-else><Clock /></el-icon>
    {{ display }}
  </span>
</template>

<style scoped>
.sp-countdown {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 700;
}

.sp-countdown.normal { color: var(--sp-gray-500); }
.sp-countdown.urgent { color: var(--sp-orange); }
.sp-countdown.critical { color: var(--sp-red); }
.sp-countdown.expired { color: var(--sp-gray-400); }

.pulse-icon {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
