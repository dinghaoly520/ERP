<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function onScroll() {
  if (timer) return
  timer = setTimeout(() => {
    visible.value = window.scrollY > 400
    timer = null
  }, 100)
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => { window.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer) })

function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
</script>

<template>
  <Transition name="btt-fade">
    <button v-if="visible" class="btt-btn" @click="scrollTop" aria-label="回到顶部">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 16V4M10 4L5 9M10 4l5 5"/></svg>
    </button>
  </Transition>
</template>

<style scoped>
.btt-btn {
  position: fixed; bottom: 32px; right: 32px; z-index: 999;
  width: 44px; height: 44px; border-radius: 14px; border: 1px solid var(--sp-border);
  background: #fff; color: var(--sp-gray-600); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(15,47,87,0.08); transition: all 0.2s;
}
.btt-btn:hover { border-color: var(--sp-primary); color: var(--sp-primary); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(6,78,162,0.14); }
.btt-fade-enter-active, .btt-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.btt-fade-enter-from, .btt-fade-leave-to { opacity: 0; transform: translateY(8px); }
</style>
