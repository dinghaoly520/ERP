<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  label: string
  value: string | number
  suffix?: string
  to?: string
  tone?: string
}>()

const router = useRouter()
function onClick() {
  if (props.to) router.push(props.to)
}
</script>

<template>
  <div class="kpi-card" :class="{ clickable: !!to }" @click="onClick">
    <span class="kpi-card__label">{{ label }}</span>
    <span class="kpi-card__value" :style="tone ? ({ '--kpi-tone': tone } as any) : undefined">
      {{ value }}<small v-if="suffix">{{ suffix }}</small>
    </span>
  </div>
</template>
