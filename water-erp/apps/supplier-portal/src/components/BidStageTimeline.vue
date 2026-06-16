<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ stage: string; aborted?: boolean }>()

const STAGES = [
  { key: 'SUBMIT', label: '已提交' },
  { key: 'OPENING', label: '开标' },
  { key: 'EVALUATING', label: '评标' },
  { key: 'ARCHIVED', label: '归档' },
] as const

const currentIndex = computed(() => {
  const idx = STAGES.findIndex(s => s.key === props.stage)
  return idx < 0 ? 0 : idx
})

function stateFor(i: number): 'done' | 'current' | 'pending' {
  if (props.aborted) return i <= currentIndex.value ? 'done' : 'pending'
  if (i < currentIndex.value) return 'done'
  if (i === currentIndex.value) return 'current'
  return 'pending'
}
</script>

<template>
  <div class="bid-timeline" :class="{ aborted }">
    <template v-for="(s, i) in STAGES" :key="s.key">
      <div class="bt-node">
        <span class="bt-dot" :class="stateFor(i)"></span>
        <span class="bt-label" :class="stateFor(i)">{{ s.label }}</span>
      </div>
      <div v-if="i < STAGES.length - 1" class="bt-line" :class="{ done: stateFor(i) === 'done' }"></div>
    </template>
  </div>
</template>

<style scoped>
.bid-timeline { display: flex; align-items: center; gap: 0; }
.bt-node { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
.bt-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--sp-gray-200); border: 2px solid var(--sp-gray-200); transition: all 0.3s; }
.bt-dot.done { background: var(--sp-primary); border-color: var(--sp-primary); }
.bt-dot.current { background: #fff; border-color: var(--sp-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-primary) 22%, transparent); animation: btPulse 1.8s ease-in-out infinite; }
.bt-label { font-size: 11px; font-weight: 600; color: var(--sp-gray-400); white-space: nowrap; }
.bt-label.done { color: var(--sp-primary); }
.bt-label.current { color: var(--sp-primary); font-weight: 800; }
.bt-line { flex: 1; height: 2px; background: var(--sp-gray-200); margin: 0 6px; margin-bottom: 16px; border-radius: 1px; transition: background 0.3s; min-width: 16px; }
.bt-line.done { background: var(--sp-primary); }
.bid-timeline.aborted .bt-dot.current { border-color: var(--sp-gray-400); animation: none; }
.bid-timeline.aborted .bt-label.current { color: var(--sp-gray-500); }
@keyframes btPulse { 0%,100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-primary) 22%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--sp-primary) 10%, transparent); } }
@media (prefers-reduced-motion: reduce) { .bt-dot.current { animation: none; } }
</style>
