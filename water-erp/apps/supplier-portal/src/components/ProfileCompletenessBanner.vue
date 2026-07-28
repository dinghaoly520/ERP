<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheckFilled, ArrowRight } from '@element-plus/icons-vue'

const props = defineProps<{ score: number; missing: string[] }>()
const router = useRouter()

// Enterprise evaluation dimensions
const DIMENSIONS = [
  { key: 'basic', label: '企业资质', weight: 45, gradient: ['#1a56db', '#2563EB'], items: ['企业名称', '统一社会信用代码', '企业类型', '法定代表人', '注册地址', '经营范围'] },
  { key: 'contacts', label: '履约能力', weight: 20, gradient: ['#0e7490', '#0891b2'], items: ['联系人', '主要联系人'] },
  { key: 'qualifications', label: '专业资质', weight: 35, gradient: ['#047857', '#059669'], items: ['资质材料', '营业执照'] },
] as const

const dimensions = computed(() => {
  return DIMENSIONS.map((dim) => {
    const totalItems = dim.items.length
    const missingInDim = dim.items.filter((item) => props.missing.includes(item)).length
    const completed = totalItems - missingInDim
    const pct = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0
    return { ...dim, pct }
  })
})

const scoreColor = computed(() => {
  if (props.score >= 80) return '#059669'
  if (props.score >= 50) return '#d97706'
  return '#dc2626'
})

const scoreLabel = computed(() => {
  if (props.score >= 90) return '优质'
  if (props.score >= 70) return '良好'
  if (props.score >= 50) return '一般'
  return '待提升'
})
</script>

<template>
  <div class="banner">
    <!-- Left: Score ring -->
    <div class="banner-score-area">
      <div class="banner-ring">
        <svg viewBox="0 0 100 100" class="banner-ring-svg">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#edf2f7" stroke-width="6" />
          <circle
            cx="50" cy="50" r="40" fill="none"
            :stroke="scoreColor"
            stroke-width="6"
            stroke-linecap="round"
            :stroke-dasharray="`${score * 2.513} 251.3`"
            transform="rotate(-90 50 50)"
            class="banner-ring-progress"
          />
        </svg>
        <div class="banner-ring-text">
          <span class="banner-ring-num" :style="{ color: scoreColor }">{{ score }}</span>
          <span class="banner-ring-unit">分</span>
        </div>
      </div>
      <div class="banner-score-label" :style="{ color: scoreColor }">{{ scoreLabel }}</div>
    </div>

    <!-- Center: Multi-color gradient bar -->
    <div class="banner-bar-wrap">
      <div class="banner-bar">
        <div
          v-for="dim in dimensions"
          :key="dim.key"
          class="banner-bar-seg"
          :style="{
            width: `${dim.weight}%`,
            background: `linear-gradient(135deg, ${dim.gradient[0]}, ${dim.gradient[1]})`,
            opacity: dim.pct > 0 ? 0.9 : 0.15,
            filter: dim.pct > 0 ? 'saturate(1)' : 'saturate(0.3)',
          }"
        >
          <span class="banner-bar-seg-label" v-if="dim.pct >= 50">{{ dim.label }}</span>
        </div>
      </div>
    </div>

    <!-- Right: Action -->
    <div class="banner-action-area">
      <el-button
        v-if="score < 100"
        type="primary"
        size="small"
        @click="router.push('/profile')"
      >
        完善资料 <el-icon><ArrowRight /></el-icon>
      </el-button>
      <span v-else class="banner-all-done">
        <el-icon color="#059669"><CircleCheckFilled /></el-icon>
        资料齐全
      </span>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: 24px;
  background: rgba(255,255,255,0.72); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.48);
  border-radius: var(--sp-radius-md);
  padding: 16px 24px;
}

.banner-score-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.banner-ring {
  position: relative;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
}
.banner-ring-svg { width: 100%; height: 100%; }
.banner-ring-progress {
  transition: stroke-dasharray 1s cubic-bezier(0.4, 0, 0.2, 1);
}
.banner-ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  padding-top: 6px;
}
.banner-ring-num {
  font-size: 24px;
  font-weight: 950;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.banner-ring-unit {
  font-size: 11px;
  color: var(--sp-gray-400);
  font-weight: 700;
}
.banner-score-label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.banner-bar-wrap {
  flex: 1;
  min-width: 0;
}
.banner-bar {
  display: flex;
  height: 32px;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}
.banner-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
  pointer-events: none;
}
.banner-bar-seg {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.5s, filter 0.5s;
  position: relative;
}
.banner-bar-seg:first-child { border-radius: 10px 0 0 10px; }
.banner-bar-seg:last-child { border-radius: 0 10px 10px 0; }
.banner-bar-seg-label {
  font-size: 11px;
  font-weight: 900;
  color: #fff;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.banner-action-area {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.banner-all-done {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
  color: #059669;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .banner {
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px;
  }
  .banner-score-area {
    flex-direction: row;
    gap: 10px;
  }
  .banner-ring { width: 56px; height: 56px; }
  .banner-ring-num { font-size: 20px; }
  .banner-bar-wrap { width: 100%; order: 1; }
  .banner-action-area { margin-left: auto; }
}
</style>
