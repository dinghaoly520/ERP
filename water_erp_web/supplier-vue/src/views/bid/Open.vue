<script setup>
import { ElMessage } from 'element-plus'
import { FolderOpened, Bell, DocumentChecked, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const decryptType = status => ({ success: 'success', running: 'primary', danger: 'danger', pending: 'warning' }[status] || 'info')
const decryptLabel = status => ({ success: '解密成功', running: '解密中', danger: '异常', pending: '待解密' }[status] || '未知')
const notify = () => ElMessage.success('已向待解密供应商发送在线解密提醒。')
const record = () => ElMessage.success('开标记录已生成并写入监督日志。')
</script>

<template>
  <div class="page-container open-page">
    <div class="page-header"><h1 class="page-title">在线开标大厅</h1><p class="page-subtitle">到时自动提取投标文件，提示投标人在线解密，生成开标记录</p></div>

    <div class="opening-hero content-card">
      <div><el-icon><FolderOpened /></el-icon></div>
      <section>
        <h2>{{ bidStore.projects[0].name }}</h2>
        <p>开标时间：{{ bidStore.projects[0].openTime }} ｜ 解密窗口：{{ bidStore.openingSession.decryptWindow }}</p>
        <p>主持人：{{ bidStore.openingSession.host }} ｜ 监督人：{{ bidStore.openingSession.supervisor }}</p>
      </section>
      <aside><span>剩余时间</span><strong>{{ bidStore.openingSession.remaining }}</strong><el-tag type="primary">{{ bidStore.openingSession.status }}</el-tag></aside>
    </div>

    <div class="action-row">
      <el-button type="primary" @click="notify"><el-icon><Bell /></el-icon>发送解密提醒</el-button>
      <el-button type="success" @click="record"><el-icon><DocumentChecked /></el-icon>生成开标记录</el-button>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">投标人在线解密状态</h2></div>
      <el-table :data="bidStore.suppliers" border>
        <el-table-column prop="name" label="投标单位" min-width="220" />
        <el-table-column prop="receipt" label="投标回执" width="160" />
        <el-table-column prop="encrypt" label="密文状态" width="130" />
        <el-table-column label="解密状态" width="120"><template #default="{ row }"><el-tag :type="decryptType(row.decrypt)">{{ decryptLabel(row.decrypt) }}</el-tag></template></el-table-column>
        <el-table-column prop="confirm" label="确认状态" width="130" />
      </el-table>
    </div>

    <div class="open-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">开标记录</h2></div>
        <el-table :data="bidStore.openingRecords" border>
          <el-table-column prop="supplier" label="供应商" min-width="200" />
          <el-table-column prop="amount" label="报价" width="120" />
          <el-table-column prop="period" label="工期/服务期" width="120" />
          <el-table-column prop="quality" label="质量目标" width="100" />
          <el-table-column prop="bond" label="保证金" width="100" />
          <el-table-column prop="confirm" label="确认" width="100" />
        </el-table>
      </div>
      <div class="content-card exception-card">
        <div class="card-header"><h2 class="card-title">异常处理</h2><el-icon class="text-warning"><Warning /></el-icon></div>
        <p><strong>四川宏达水利工程有限公司：</strong>证书校验失败，初步判定为投标人原因。</p>
        <p><strong>处理意见：</strong>保留插件日志、证书校验截图、在线提醒记录，提交监督端确认。</p>
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
.text-warning { color: #f5a623; }
.opening-hero { display: grid; grid-template-columns: 72px 1fr 180px; align-items: center; gap: 18px; background: linear-gradient(135deg, #063f82, #0a7ed3); color: #fff; border: none; }
.opening-hero .el-icon { font-size: 46px; }
.opening-hero h2 { font-size: 22px; margin: 0 0 8px; }
.opening-hero p { color: rgba(255,255,255,.82); margin: 4px 0; }
.opening-hero aside { text-align: center; background: rgba(255,255,255,.14); border-radius: 8px; padding: 14px; }
.opening-hero aside span { display: block; opacity: .8; }
.opening-hero aside strong { display: block; font-size: 28px; margin: 4px 0 10px; }
.action-row { display: flex; gap: 12px; margin-bottom: 16px; }
.open-grid { display: grid; grid-template-columns: 1.5fr .8fr; gap: 16px; }
.exception-card p { line-height: 1.9; color: #536078; margin-bottom: 10px; }
@media (max-width: 1000px) { .opening-hero, .open-grid { grid-template-columns: 1fr; } }
</style>
