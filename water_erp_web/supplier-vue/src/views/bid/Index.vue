<script setup>
import { useRouter } from 'vue-router'
import { DataLine, Lock, Upload, FolderOpened, UserFilled, View, Box, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const router = useRouter()
const bidStore = useBidStore()

const roleEntries = [
  { title: '供应商端', desc: '插件授权、受控下载、加密投递、提交回执', path: '/bid/submit', icon: Upload },
  { title: '开标主持端', desc: '到时开标、在线解密、开标记录、异常处理', path: '/bid/open', icon: FolderOpened },
  { title: '专家评标端', desc: '身份核验、独立评分、澄清说明、报告确认', path: '/bid/evaluate', icon: UserFilled },
  { title: '监督端', desc: '节点监督、日志追溯、异常留痕、不可干预', path: '/bid/supervise', icon: View },
  { title: '归档端', desc: '资料清单、完整率、防篡改摘要、一键归档', path: '/bid/archive', icon: Box }
]

const lifecycle = ['插件授权', '文件下载', '加密投递', '到时开标', '专家评标', '报告归档']
</script>

<template>
  <div class="bid-workbench page-container">
    <div class="page-header bid-header">
      <div>
        <h1 class="page-title">开评标系统</h1>
        <p class="page-subtitle">统一入口、多端协同、安全可控、限时开标、独立评审、全程留痕</p>
      </div>
      <el-button type="primary" @click="router.push('/bid/open')">进入在线开标大厅</el-button>
    </div>

    <div class="stats-grid">
      <div v-for="stat in bidStore.dashboardStats" :key="stat.label" class="stat-card">
        <div :class="['stat-icon', stat.color]"><el-icon><DataLine /></el-icon></div>
        <div><strong>{{ stat.value }}{{ stat.unit }}</strong><span>{{ stat.label }}</span></div>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">核心流程闭环</h2><el-tag type="primary">演示项目：BID-2026-0518</el-tag></div>
      <div class="lifecycle-chain">
        <div v-for="(item, index) in lifecycle" :key="item" class="lifecycle-item">
          <div class="lifecycle-index">{{ index + 1 }}</div>
          <span>{{ item }}</span>
        </div>
      </div>
    </div>

    <div class="role-grid">
      <article v-for="entry in roleEntries" :key="entry.path" class="role-card" @click="router.push(entry.path)">
        <div class="role-icon"><el-icon><component :is="entry.icon" /></el-icon></div>
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.desc }}</p>
        <el-button type="primary" link>进入工作台 →</el-button>
      </article>
    </div>

    <div class="dashboard-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">项目状态</h2></div>
        <el-table :data="bidStore.projects" border style="width: 100%">
          <el-table-column prop="id" label="项目编号" width="150" />
          <el-table-column prop="name" label="项目名称" min-width="220" />
          <el-table-column prop="openTime" label="开标时间" width="165" />
          <el-table-column label="阶段" width="110">
            <template #default="{ row }">
              <el-tag :style="{ color: bidStore.stageMap[row.stage].color, borderColor: bidStore.stageMap[row.stage].color, background: bidStore.stageMap[row.stage].color + '12' }">
                {{ bidStore.stageMap[row.stage].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="risk" label="风险提示" min-width="150" />
        </el-table>
      </div>

      <div class="content-card risk-card">
        <div class="card-header"><h2 class="card-title">风险提醒</h2><el-icon class="text-warning"><Warning /></el-icon></div>
        <ul class="risk-list">
          <li><el-icon><Lock /></el-icon>开标前仅展示密文状态，不提供明文下载入口。</li>
          <li><el-icon><Warning /></el-icon>四川宏达水利工程有限公司存在证书校验异常。</li>
          <li><el-icon><Warning /></el-icon>专家评分存在偏差提醒，需提交确认理由。</li>
          <li><el-icon><Box /></el-icon>评标报告和结果公示资料尚未完成归档。</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bid-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #fff; border: 1px solid #e8f0fa; border-radius: 8px; padding: 20px; display: flex; align-items: center; gap: 14px; }
.stat-icon { width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.stat-icon.blue { background: #e8f2ff; color: #064ea2; }
.stat-icon.green { background: #e8fff0; color: #11a874; }
.stat-icon.orange { background: #fff8e8; color: #f5a623; }
.stat-card strong { display: block; font-size: 24px; color: #18243a; }
.stat-card span { color: #8a9aaa; font-size: 13px; }
.content-card { background: #fff; border: 1px solid #e8f0fa; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.card-title { font-size: 17px; font-weight: 800; color: #18243a; margin: 0; }
.text-warning { color: #f5a623; }
.lifecycle-chain { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.lifecycle-item { position: relative; padding: 18px 12px; border: 1px solid #e8f0fa; border-radius: 8px; background: linear-gradient(135deg, #f8fbff, #eef6ff); text-align: center; font-weight: 700; color: #064ea2; }
.lifecycle-index { width: 28px; height: 28px; margin: 0 auto 8px; border-radius: 50%; background: #064ea2; color: #fff; display: flex; align-items: center; justify-content: center; }
.role-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
.role-card { background: #fff; border: 1px solid #e8f0fa; border-radius: 8px; padding: 20px; cursor: pointer; transition: all .25s; }
.role-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(6, 78, 162, 0.1); border-color: #b8d4f5; }
.role-icon { width: 44px; height: 44px; border-radius: 10px; background: #e8f2ff; color: #064ea2; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 14px; }
.role-card h3 { font-size: 16px; margin: 0 0 8px; color: #18243a; }
.role-card p { color: #8a9aaa; min-height: 44px; margin: 0 0 10px; font-size: 13px; }
.dashboard-grid { display: grid; grid-template-columns: 1.6fr .8fr; gap: 16px; }
.risk-list { list-style: none; display: grid; gap: 14px; padding: 0; margin: 0; }
.risk-list li { display: flex; gap: 10px; color: #536078; line-height: 1.7; font-size: 13px; }
@media (max-width: 1200px) { .stats-grid, .role-grid { grid-template-columns: repeat(2, 1fr); } .lifecycle-chain, .dashboard-grid { grid-template-columns: 1fr; } }
</style>
