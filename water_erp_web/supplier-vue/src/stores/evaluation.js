import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useEvaluationStore = defineStore('evaluation', () => {
  // 评价记录
  const evaluations = ref([])

  // 异常记录
  const abnormalRecords = ref([])

  // 评价指标配置
  const indicators = ref([
    { id: 1, name: '资料完整性', weight: 20, description: '注册资料、资质文件、投标材料是否完整' },
    { id: 2, name: '文件响应情况', weight: 30, description: '投标文件是否响应招标文件要求' },
    { id: 3, name: '参与配合情况', weight: 20, description: '是否按时提交材料、配合开评标工作' },
    { id: 4, name: '规范合规情况', weight: 20, description: '是否存在异常、虚假、违规行为' },
    { id: 5, name: '综合评价', weight: 10, description: '采购中心员工综合意见' }
  ])

  // 模拟评价数据
  const mockEvaluations = ref([
    {
      id: 'EVL-2024-001',
      supplierId: 'SUP-2024-0001',
      supplierName: '四川川水建设工程有限公司',
      projectId: 'PRJ-2024-001',
      projectName: '紫坪铺水库加固工程',
      scores: {
        dataIntegrity: 95,
        fileResponse: 98,
        cooperation: 92,
        compliance: 96,
        overall: 95
      },
      totalScore: 95,
      level: 'A',
      comment: '供应商在项目执行过程中表现优秀，资料完整，响应及时，配合度高，无违规行为。',
      evaluator: '王建国',
      evaluateDate: '2024-06-10',
      status: 'confirmed'
    },
    {
      id: 'EVL-2024-002',
      supplierId: 'SUP-2024-0002',
      supplierName: '成都华西物资供应有限公司',
      projectId: 'PRJ-2024-003',
      projectName: '水利物资集中采购项目',
      scores: {
        dataIntegrity: 92,
        fileResponse: 95,
        cooperation: 98,
        compliance: 100,
        overall: 96
      },
      totalScore: 96,
      level: 'A',
      comment: '物资供应及时，质量稳定，服务态度好。',
      evaluator: '李明华',
      evaluateDate: '2024-05-25',
      status: 'confirmed'
    },
    {
      id: 'EVL-2024-003',
      supplierId: 'SUP-2024-0003',
      supplierName: '四川智水科技有限公司',
      projectId: 'PRJ-2024-004',
      projectName: '智慧水务信息化系统建设',
      scores: {
        dataIntegrity: 88,
        fileResponse: 90,
        cooperation: 85,
        compliance: 95,
        overall: 90
      },
      totalScore: 90,
      level: 'A',
      comment: '技术方案有创新，项目执行过程配合度有待提高。',
      evaluator: '张晓燕',
      evaluateDate: '2024-04-18',
      status: 'confirmed'
    }
  ])

  // 模拟异常记录
  const mockAbnormals = ref([
    {
      id: 'ABN-2024-001',
      supplierId: 'SUP-2024-0006',
      supplierName: '四川某建筑工程有限公司',
      type: 'submit_fake',
      typeName: '提交虚假材料',
      description: '供应商提交的资质证书经核验为伪造文件',
      projectName: '某水利工程项目',
      evidence: '/files/evidence1.pdf',
      handler: '王建国',
      handleResult: '列入黑名单，禁止参与平台业务',
      handleDate: '2024-03-20',
      status: 'resolved'
    },
    {
      id: 'ABN-2024-002',
      supplierId: 'SUP-2024-0007',
      supplierName: '成都某物资有限公司',
      type: 'abandon_bid',
      typeName: '无故放弃投标',
      description: '中标后无故放弃，未提供合理理由',
      projectName: '材料采购项目',
      evidence: '',
      handler: '李明华',
      handleResult: '警告处理，扣减信用分',
      handleDate: '2024-04-10',
      status: 'resolved'
    }
  ])

  // 统计数据
  const statistics = ref({
    totalEvaluations: 156,
    averageScore: 87.5,
    levelDistribution: {
      A: 68,
      B: 52,
      C: 28,
      D: 8
    },
    abnormalCount: 12,
    blacklistedCount: 3
  })

  // 等级配置
  const levels = [
    { name: 'A', minScore: 90, color: '#11a874', label: '优秀' },
    { name: 'B', minScore: 80, color: '#0e62d0', label: '良好' },
    { name: 'C', minScore: 60, color: '#f5a623', label: '一般' },
    { name: 'D', minScore: 0, color: '#e74c3c', label: '较差' }
  ]

  // 异常类型配置
  const abnormalTypes = [
    { value: 'submit_fake', label: '提交虚假材料' },
    { value: 'incomplete_docs', label: '投标文件严重缺项' },
    { value: 'late_submit', label: '未按要求提交文件' },
    { value: 'abandon_bid', label: '无故放弃投标' },
    { value: 'suspicious_bidding', label: '投标文件异常一致' },
    { value: 'contact_invalid', label: '联系方式失效' },
    { value: 'rule_violation', label: '违反平台管理规则' },
    { value: 'other', label: '其他异常行为' }
  ]

  // 计算属性
  const recentEvaluations = computed(() =>
    mockEvaluations.value.slice(0, 10)
  )

  // 方法
  const getEvaluationById = (id) => {
    return mockEvaluations.value.find(e => e.id === id)
  }

  const getEvaluationsBySupplier = (supplierId) => {
    return mockEvaluations.value.filter(e => e.supplierId === supplierId)
  }

  const addEvaluation = (evaluation) => {
    const newId = `EVL-2024-${String(mockEvaluations.value.length + 1).padStart(3, '0')}`
    const totalScore = calculateTotalScore(evaluation.scores)
    const level = getLevel(totalScore)
    mockEvaluations.value.push({
      ...evaluation,
      id: newId,
      totalScore,
      level,
      evaluateDate: new Date().toISOString().split('T')[0],
      status: 'confirmed'
    })
    return newId
  }

  const calculateTotalScore = (scores) => {
    let total = 0
    indicators.value.forEach(indicator => {
      const key = getIndicatorKey(indicator.id)
      if (scores[key] !== undefined) {
        total += scores[key] * (indicator.weight / 100)
      }
    })
    return Math.round(total * 10) / 10
  }

  const getLevel = (score) => {
    for (const level of levels) {
      if (score >= level.minScore) return level.name
    }
    return 'D'
  }

  const getIndicatorKey = (id) => {
    const map = {
      1: 'dataIntegrity',
      2: 'fileResponse',
      3: 'cooperation',
      4: 'compliance',
      5: 'overall'
    }
    return map[id] || ''
  }

  const addAbnormalRecord = (record) => {
    const newId = `ABN-2024-${String(mockAbnormals.value.length + 1).padStart(3, '0')}`
    mockAbnormals.value.push({
      ...record,
      id: newId,
      status: 'pending'
    })
    return newId
  }

  const updateIndicator = (id, data) => {
    const indicator = indicators.value.find(i => i.id === id)
    if (indicator) {
      Object.assign(indicator, data)
    }
  }

  return {
    evaluations,
    abnormalRecords,
    indicators,
    mockEvaluations,
    mockAbnormals,
    statistics,
    levels,
    abnormalTypes,
    recentEvaluations,
    getEvaluationById,
    getEvaluationsBySupplier,
    addEvaluation,
    calculateTotalScore,
    getLevel,
    addAbnormalRecord,
    updateIndicator
  }
})