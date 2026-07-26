<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="app-root">
    <!-- cgzxui 水彩光晕：五角 oklch 浅彩 bloom，作为玻璃面板背后漂移的色彩层
         （移植自 :3002 public-portal / :3005 web 的 .flow-glow） -->
    <div class="flow-glow" aria-hidden />
    <div class="app-root__content">
      <RouterView />
    </div>
  </div>
</template>

<style>
/* cgzxui 全局画布 —— .app-root 承载不透明冷白底色 var(--bg)，
   .flow-glow 是唯一色彩源（与 public-portal / web 一致）。
   .app-root__content 提升到 flow-glow 之上，确保所有路由内容可点击。 */
.app-root {
  position: relative;
  min-height: 100vh;
  background: var(--bg);
}
.app-root__content {
  position: relative;
  z-index: 1;
}
</style>
