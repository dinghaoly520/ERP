<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  sub?: string
  eyebrow?: string
}>()
</script>

<template>
  <div class="page-hero">
    <div class="page-hero__row">
      <div class="page-hero__left">
        <div class="page-hero__icon">
          <component :is="icon" :size="17" :stroke-width="1.75" />
        </div>
        <div>
          <div v-if="eyebrow" class="page-hero__eyebrow">{{ eyebrow }}</div>
          <div class="page-hero__title">{{ title }}</div>
          <div v-if="sub" class="page-hero__sub">{{ sub }}</div>
        </div>
      </div>
      <div v-if="$slots.actions" class="page-hero__right">
        <slot name="actions" />
      </div>
    </div>
    <template v-if="$slots.body">
      <hr class="page-hero__rule wb-section-rule" />
      <slot name="body" />
    </template>
  </div>
</template>
