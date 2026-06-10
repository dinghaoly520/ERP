import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useBidStore = defineStore('bid', () => {
  const statusColorMap = {
    pending: '#f5a623',
    running: '#064ea2',
    success: '#11a874',
    danger: '#e74c3c',
    muted: '#8a9aaa'
  }

  const stageMap = {
    download: { label: '文件下载', color: statusColorMap.running },
    submit: { label: '加密投递', color: statusColorMap.running },
    opening: { label: '在线开标', color: statusColorMap.pending },
    evaluating: { label: '专家评标', color: statusColorMap.running },
    archived: { label: '资料归档', color: statusColorMap.success }
  }

  const projects = ref([
    {
      id: 'BID-2026-0518',
      name: '2026年度水利工程物资集中采购',
      method: '公开招标',
      openTime: '2026-06-08 09:30',
      deadline: '2026-06-08 09:00',
      stage: 'opening',
      risk: '解密窗口进行中',
      bidderCount: 5,
      encryptedCount: 5,
      archiveRate: 86
    },
    {
      id: 'BID-2026-0522',
      name: '智慧水务信息化系统建设项目',
      method: '综合评分法',
      openTime: '2026-06-10 14:30',
      deadline: '2026-06-10 14:00',
      stage: 'submit',
      risk: '1家插件版本过旧',
      bidderCount: 4,
      encryptedCount: 3,
      archiveRate: 42
    },
    {
      id: 'BID-2026-0526',
      name: '升钟水库灌区续建配套工程',
      method: '经评审最低价法',
      openTime: '2026-06-05 10:00',
      deadline: '2026-06-05 09:30',
      stage: 'archived',
      risk: '资料已归档',
      bidderCount: 6,
      encryptedCount: 6,
      archiveRate: 100
    }
  ])

  const securityComponent = ref({
    companyName: '四川川水建设工程有限公司',
    companyCode: '91510000MA62K5XX0X',
    licenseNo: 'SCWF-SEC-2026-00018',
    pluginVersion: 'v3.6.2',
    authorizedDevices: 4,
    maxDevices: 5,
    certificateStatus: '有效',
    certificateExpire: '2027-05-31'
  })

  const suppliers = ref([
    { id: 'SUP-001', name: '四川川水建设工程有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-001', decrypt: 'success', confirm: '已确认' },
    { id: 'SUP-002', name: '成都华西物资供应有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-002', decrypt: 'success', confirm: '已确认' },
    { id: 'SUP-003', name: '四川智水科技有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-003', decrypt: 'running', confirm: '待确认' },
    { id: 'SUP-004', name: '四川宏达水利工程有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-004', decrypt: 'danger', confirm: '异常待处理' },
    { id: 'SUP-005', name: '成都诚信建材有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-005', decrypt: 'pending', confirm: '待确认' }
  ])

  const openingSession = ref({
    projectId: 'BID-2026-0518',
    host: '采购中心-李主任',
    supervisor: '纪检监督-周老师',
    status: '解密中',
    decryptWindow: '09:30 - 10:00',
    remaining: '00:18:42'
  })

  const openingRecords = ref([
    { supplier: '四川川水建设工程有限公司', amount: '1260.00万元', period: '120日历天', quality: '合格', bond: '已缴纳', decrypt: '解密成功', confirm: '已确认' },
    { supplier: '成都华西物资供应有限公司', amount: '1288.50万元', period: '118日历天', quality: '合格', bond: '已缴纳', decrypt: '解密成功', confirm: '已确认' },
    { supplier: '四川智水科技有限公司', amount: '1320.00万元', period: '115日历天', quality: '合格', bond: '电子保函', decrypt: '解密中', confirm: '待确认' }
  ])

  const experts = ref([
    { id: 'EXP-001', name: '王建国', major: '水利工程', signed: true, avoidance: true, progress: 92, score: 91.6 },
    { id: 'EXP-002', name: '刘晓梅', major: '机电设备', signed: true, avoidance: true, progress: 86, score: 89.4 },
    { id: 'EXP-003', name: '陈志强', major: '造价咨询', signed: true, avoidance: true, progress: 78, score: 88.1 }
  ])

  const scoreItems = ref([
    { id: 'qualification', name: '资格性审查', max: 0, result: '通过', score: 0, reason: '营业执照、资质证书、授权文件均符合要求。' },
    { id: 'responsive', name: '符合性审查', max: 0, result: '通过', score: 0, reason: '投标文件响应招标文件实质性条款。' },
    { id: 'business', name: '商务评分', max: 20, result: '已评分', score: 18, reason: '企业业绩、履约能力较好。' },
    { id: 'technical', name: '技术评分', max: 50, result: '已评分', score: 43, reason: '技术方案完整，施工组织安排较合理。' },
    { id: 'price', name: '价格评分', max: 30, result: '系统计算', score: 28.6, reason: '报价处于有效评审区间。' }
  ])

  const clarifications = ref([
    { id: 'CL-001', question: '请说明主要设备交货计划与施工节点衔接安排。', issuer: '王建国', supplier: '四川智水科技有限公司', status: '已回复', reply: '已补充交货计划说明，不改变投标实质内容。' }
  ])

  const supervisionLogs = ref([
    { time: '2026-06-08 08:55', role: '系统', target: '投标文件', action: '投标截止自动锁定', result: '成功', risk: '无' },
    { time: '2026-06-08 09:30', role: '开标主持人', target: '在线开标大厅', action: '启动开标', result: '成功', risk: '无' },
    { time: '2026-06-08 09:42', role: '供应商', target: '投标文件解密', action: '证书校验失败', result: '异常', risk: '投标人原因待确认' },
    { time: '2026-06-08 10:05', role: '专家', target: '技术评分', action: '提交评分', result: '成功', risk: '存在偏差提醒' }
  ])

  const archiveItems = ref([
    { name: '招标文件定稿', owner: '招标管理端', status: '已归档', hash: 'SHA256-A19C8E', time: '2026-06-08 08:30' },
    { name: '招标文件下载日志', owner: '供应商端', status: '已归档', hash: 'SHA256-B72F31', time: '2026-06-08 08:31' },
    { name: '投标文件提交回执', owner: '供应商端', status: '已归档', hash: 'SHA256-C08A92', time: '2026-06-08 09:00' },
    { name: '在线开标记录', owner: '开标主持端', status: '已归档', hash: 'SHA256-D55E02', time: '2026-06-08 10:05' },
    { name: '专家评分汇总表', owner: '专家评标端', status: '待归档', hash: '待生成', time: '-' },
    { name: '评标报告', owner: '专家评标端', status: '待确认', hash: '待生成', time: '-' },
    { name: '结果公示截图', owner: '归档端', status: '未开始', hash: '待生成', time: '-' }
  ])

  const dashboardStats = computed(() => {
    const decryptSuccess = suppliers.value.filter(item => item.decrypt === 'success').length
    const expertProgress = Math.round(experts.value.reduce((sum, item) => sum + item.progress, 0) / experts.value.length)
    const archived = archiveItems.value.filter(item => item.status === '已归档').length
    return [
      { label: '待开标项目', value: projects.value.filter(item => item.stage !== 'archived').length, unit: '个', color: 'blue' },
      { label: '密文投递数', value: suppliers.value.length, unit: '份', color: 'green' },
      { label: '解密成功率', value: Math.round((decryptSuccess / suppliers.value.length) * 100), unit: '%', color: 'orange' },
      { label: '评审完成率', value: expertProgress, unit: '%', color: 'blue' },
      { label: '归档完整率', value: Math.round((archived / archiveItems.value.length) * 100), unit: '%', color: 'green' }
    ]
  })

  const totalScore = computed(() => scoreItems.value.reduce((sum, item) => sum + Number(item.score || 0), 0))

  const markSubmitted = () => {
    suppliers.value[0].submit = '已提交'
    suppliers.value[0].encrypt = '密文已校验'
    suppliers.value[0].receipt = 'TB-20260608-001'
  }

  const markArchiveComplete = () => {
    archiveItems.value.forEach((item, index) => {
      item.status = '已归档'
      item.hash = item.hash === '待生成' ? `SHA256-${String(index + 11).padStart(2, '0')}F6A9` : item.hash
      item.time = item.time === '-' ? '2026-06-08 11:30' : item.time
    })
  }

  return {
    statusColorMap,
    stageMap,
    projects,
    securityComponent,
    suppliers,
    openingSession,
    openingRecords,
    experts,
    scoreItems,
    clarifications,
    supervisionLogs,
    archiveItems,
    dashboardStats,
    totalScore,
    markSubmitted,
    markArchiveComplete
  }
})
