<script setup lang="ts">
import { useRouter } from 'vue-router'
import { SearchX, Home, ArrowLeft } from 'lucide-vue-next'

const router = useRouter()
</script>

<template>
  <div class="not-found-page">
    <div class="not-found-card">
      <div class="nf-art"><SearchX :size="22" :stroke-width="1.75" /></div>
      <div class="error-code">404</div>
      <h2 class="error-title">页面未找到</h2>
      <p class="error-desc">抱歉，您访问的页面不存在或已被移除</p>
      <div class="error-actions">
        <router-link to="/dashboard" class="neu-btn-primary">
          <Home :size="17" :stroke-width="1.75" />返回首页
        </router-link>
        <button class="neu-btn-soft" @click="router.back()">
          <ArrowLeft :size="17" :stroke-width="1.75" />返回上页
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 24px;
}

/* Neumorphic plate (no glass / no drift) */
.not-found-card {
  text-align: center;
  padding: 56px 64px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.10), -6px -6px 14px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.75);
  animation: nf-in 0.5s ease backwards;
}
@keyframes nf-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Concave icon well */
.nf-art {
  width: 64px; height: 64px; margin: 0 auto 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: var(--brand);
  background: var(--surface);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.85);
}

.error-code {
  font-size: 96px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--brand-deep);
  font-variant-numeric: tabular-nums;
  margin-bottom: 12px;
}

.error-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--foreground);
  margin: 0 0 8px;
}

.error-desc {
  font-size: 15px;
  color: var(--muted-foreground);
  margin: 0 0 32px;
}

.error-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.error-actions .neu-btn-primary { text-decoration: none; }

@media (prefers-reduced-motion: reduce) {
  .not-found-card { animation: none; }
}
</style>
