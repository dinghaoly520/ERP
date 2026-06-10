<script setup>
import { View, Lock, Warning, DocumentChecked } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'
const bidStore = useBidStore()
</script>

<template>
  <div class="page-container supervise-page">
    <div class="page-header"><h1 class="page-title">监督端</h1><p class="page-subtitle">可监督、不可干预：查看节点、日志、异常和证据链，不修改评分或敏感文件</p></div>

    <div class="supervise-banner content-card">
      <el-icon><View /></el-icon>
      <div><h2>监督权限边界</h2><p>监督人员可查看开评标过程、日志、异常记录和报告状态，但不具备开标前查看明文投标文件、修改评分、替专家提交意见的能力。</p></div>
      <el-tag type="danger">禁止干预评分</el-tag>
    </div>

    <div class="supervise-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">过程时间线</h2></div>
        <el-timeline>
          <el-timeline-item timestamp="2026-06-08 08:55" type="primary"><el-icon><Lock /></el-icon> 投标截止，系统自动锁定全部密文文件。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 09:30" type="success"><el-icon><DocumentChecked /></el-icon> 开标主持人启动在线开标大厅。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 09:42" type="warning"><el-icon><Warning /></el-icon> 发现供应商证书校验异常。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 10:05" type="primary">专家提交第一轮评分，系统提示偏差复核。</el-timeline-item>
        </el-timeline>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">异常事件</h2></div>
        <el-alert title="四川宏达水利工程有限公司解密证书校验失败" type="warning" show-icon :closable="false" />
        <el-alert title="专家技术评分偏离平均值，已要求填写确认理由" type="info" show-icon :closable="false" style="margin-top: 12px;" />
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">监督日志</h2><el-button type="primary" plain>导出模拟日志</el-button></div>
      <el-table :data="bidStore.supervisionLogs" border>
        <el-table-column prop="time" label="时间" width="165" />
        <el-table-column prop="role" label="角色" width="120" />
        <el-table-column prop="target" label="对象" width="150" />
        <el-table-column prop="action" label="操作" min-width="180" />
        <el-table-column prop="result" label="结果" width="100" />
        <el-table-column prop="risk" label="风险标记" min-width="160" />
      </el-table>
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
.supervise-banner { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 16px; background: linear-gradient(135deg, #f8fbff, #eef6ff); }
.supervise-banner > .el-icon { font-size: 38px; color: #064ea2; }
.supervise-banner h2 { margin: 0 0 6px; font-size: 17px; color: #18243a; }
.supervise-banner p { color: #536078; margin: 0; font-size: 13px; }
.supervise-grid { display: grid; grid-template-columns: 1fr .8fr; gap: 16px; }
@media (max-width: 1000px) { .supervise-banner, .supervise-grid { grid-template-columns: 1fr; } }
</style>
