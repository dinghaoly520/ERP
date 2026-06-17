<script setup lang="ts">
defineProps<{ lines?: number; avatar?: boolean }>()
</script>

<template>
  <div class="skeleton-card">
    <div v-if="avatar" class="skeleton-avatar"></div>
    <div class="skeleton-lines">
      <div v-for="i in lines || 3" :key="i" class="skeleton-line" :style="{ width: i === (lines || 3) ? '60%' : '100%' }"></div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-card {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: var(--sp-surface);
  border-radius: var(--sp-radius-md);
  border: 1px solid rgba(255,255,255,0.40);
}

.skeleton-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(90deg, var(--sp-gray-100) 25%, var(--sp-gray-50) 50%, var(--sp-gray-100) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  flex-shrink: 0;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skeleton-line {
  height: 14px;
  border-radius: 7px;
  background: linear-gradient(90deg, var(--sp-gray-100) 25%, var(--sp-gray-50) 50%, var(--sp-gray-100) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
