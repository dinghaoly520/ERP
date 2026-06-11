<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ score: number; missing: string[] }>()
const router = useRouter()

const color = computed(() => {
  if (props.score >= 80) return '#059669'
  if (props.score >= 50) return '#d97706'
  return '#dc2626'
})

const label = computed(() => {
  if (props.score >= 90) return '优秀'
  if (props.score >= 70) return '良好'
  if (props.score >= 50) return '待完善'
  return '不完整'
})
</script>

<template>
  <div class="completeness-card">
    <div class="completeness-header">
      <span class="completeness-title">资料完整度</span>
      <span class="completeness-label" :style="{ color }">{{ label }}</span>
    </div>

    <!-- Circular progress -->
    <div class="completeness-ring">
      <svg viewBox="0 0 120 120" class="ring-svg">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" stroke-width="8" />
        <circle
          cx="60" cy="60" r="52" fill="none"
          :stroke="color"
          stroke-width="8"
          stroke-linecap="round"
          :stroke-dasharray="`${score * 3.27} 327`"
          transform="rotate(-90 60 60)"
          class="ring-progress"
        />
      </svg>
      <div class="ring-text">
        <span class="ring-value" :style="{ color }">{{ score }}</span>
        <span class="ring-unit">分</span>
      </div>
    </div>

    <!-- Missing items -->
    <div v-if="missing.length > 0 && score < 100" class="completeness-missing">
      <div class="missing-title">待完善项目：</div>
      <div class="missing-tags">
        <span v-for="m in missing" :key="m" class="missing-tag">{{ m }}</span>
      </div>
      <el-button type="primary" text size="small" @click="router.push('/profile')" style="margin-top: 8px;">
        去完善 <el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>
    <div v-else-if="score >= 100" class="completeness-done">
      <el-icon color="#059669"><CircleCheckFilled /></el-icon>
      <span>资料已完善</span>
    </div>
  </div>
</template>

<style scoped>
.completeness-card {
  text-align: center;
  padding: 8px 0;
}

.completeness-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.completeness-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sp-gray-700);
}

.completeness-label {
  font-size: 13px;
  font-weight: 700;
}

.completeness-ring {
  position: relative;
  width: 120px;
  height: 120px;
  margin: 0 auto 16px;
}

.ring-svg {
  width: 100%;
  height: 100%;
}

.ring-progress {
  transition: stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  padding-top: 4px;
}

.ring-value {
  font-size: 32px;
  font-weight: 900;
  line-height: 1;
}

.ring-unit {
  font-size: 13px;
  color: var(--sp-gray-400);
}

.completeness-missing {
  text-align: left;
  padding-top: 12px;
  border-top: 1px solid var(--sp-border-light);
}

.missing-title {
  font-size: 12px;
  color: var(--sp-gray-500);
  margin-bottom: 8px;
}

.missing-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.missing-tag {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 12px;
  background: #fef3c7;
  color: #92400e;
  font-weight: 600;
}

.completeness-done {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #059669;
  padding-top: 12px;
}
</style>
