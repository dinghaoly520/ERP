<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, CircleCheck, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const archiveRate = computed(() => Math.round((bidStore.archiveItems.filter(item => item.status === '已归档').length / bidStore.archiveItems.length) * 100))
const archiveAll = () => {
  bidStore.markArchiveComplete()
  ElMessage.success('资料已完成一键归档演示，防篡改摘要已更新。')
}
</script>

<template>
  <div class="page-container archive-page">
    <div class="page-header"><h1 class="page-title">归档端</h1><p class="page-subtitle">开标记录、评分表、澄清记录、评标报告、结果公示统一归档</p></div>

    <div class="archive-summary content-card">
      <el-icon><Box /></el-icon>
      <div><h2>电子档案编号：ARCH-BID-2026-0518</h2><p>防篡改摘要：HASH-CHAIN-20260608-AF39C8E2</p></div>
      <el-progress type="circle" :percentage="archiveRate" />
      <el-button type="success" @click="archiveAll">一键归档演示</el-button>
    </div>

    <div class="archive-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">归档资料清单</h2></div>
        <el-table :data="bidStore.archiveItems" border>
          <el-table-column prop="name" label="资料名称" min-width="180" />
          <el-table-column prop="owner" label="责任端" width="130" />
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }"><el-tag :type="row.status === '已归档' ? 'success' : row.status === '待确认' ? 'warning' : 'info'">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="hash" label="哈希摘要" width="150" />
          <el-table-column prop="time" label="归档时间" width="165" />
        </el-table>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">缺失提醒</h2></div>
        <p class="archive-tip"><el-icon><Warning /></el-icon> 专家评分汇总表待归档。</p>
        <p class="archive-tip"><el-icon><Warning /></el-icon> 评标报告待专家最终确认。</p>
        <p class="archive-tip success"><el-icon><CircleCheck /></el-icon> 开标记录、投标回执和下载日志已入档。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container { padding: 24px; background: #f6f9fd; min-height: calc(100vh - 60px); }
.page-header { margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 800; color: #18243a; margin: 0 0 8px; }
.page-subtitle { font-size: 14px; color: #8a9aaa; margin: 0; }
.content-card { background: #fff; border: 1px solid #e8f0fa; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.card-title { font-size: 17px; font-weight: 800; color: #18243a; margin: 0; }
.archive-summary { display: grid; grid-template-columns: 56px 1fr 120px auto; align-items: center; gap: 18px; }
.archive-summary > .el-icon { font-size: 40px; color: #064ea2; }
.archive-summary h2 { margin: 0 0 6px; font-size: 16px; color: #18243a; }
.archive-summary p { color: #8a9aaa; margin: 0; }
.archive-grid { display: grid; grid-template-columns: 1.4fr .7fr; gap: 16px; }
.archive-tip { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 8px; background: #fff8e8; color: #536078; margin: 0 0 10px; font-size: 13px; }
.archive-tip .el-icon { color: #f5a623; }
.archive-tip.success { background: #e8fff0; }
.archive-tip.success .el-icon { color: #11a874; }
@media (max-width: 1000px) { .archive-summary, .archive-grid { grid-template-columns: 1fr; } }
</style>
