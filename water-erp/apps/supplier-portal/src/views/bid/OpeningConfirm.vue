<script setup lang="ts">
// 旧入口兼容：开标确认已并入「在线开标大厅」页
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
onMounted(() => {
  router.replace(`/my-bids/${route.params.projectId}/opening-hall`)
})
</script>

<template>
  <div style="padding: 40px; text-align: center; color: #909399">正在进入在线开标大厅…</div>
</template>
