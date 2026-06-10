import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useSupplierStore = defineStore('supplier', () => {
  // 状态
  const suppliers = ref([])
  const currentSupplier = ref(null)
  const loading = ref(false)

  // 统计数据
  const statistics = ref({
    total: 3856,
    active: 2156,
    newThisMonth: 128,
    passRate: 96,
    byStatus: {
      pending: 156,
      approved: 2156,
      rejected: 89,
      disabled: 455
    },
    byCategory: {
      engineering: 1256,
      material: 1482,
      service: 1118
    }
  })

  // 待审核列表
  const pendingAudits = ref([])

  // 待处理变更
  const pendingChanges = ref([])

  // 模拟供应商数据
  const mockSuppliers = ref([
    {
      id: 'SUP-2024-0001',
      name: '四川川水建设工程有限公司',
      creditCode: '91510000MA62K5XX0X',
      type: '国有企业',
      legalPerson: '张明',
      registerAddress: '四川省成都市高新区天府大道北段1700号',
      businessScope: '水利水电工程、市政公用工程、房屋建筑工程施工',
      status: 'approved',
      category: 'engineering',
      categoryLabel: '工程建设',
      registerDate: '2024-01-15',
      approveDate: '2024-01-20',
      contacts: [
        { name: '李华', phone: '13800138001', email: 'lihua@chuanshui.com', isMain: true },
        { name: '王芳', phone: '13800138002', email: 'wangfang@chuanshui.com', isMain: false }
      ],
      qualifications: [
        { name: '营业执照', fileUrl: '/files/license.pdf', uploadDate: '2024-01-15', expireDate: '2030-12-31' },
        { name: '水利水电工程施工总承包一级', fileUrl: '/files/qual1.pdf', uploadDate: '2024-01-15', expireDate: '2025-06-30' },
        { name: '市政公用工程施工总承包二级', fileUrl: '/files/qual2.pdf', uploadDate: '2024-01-15', expireDate: '2025-08-31' }
      ],
      projects: [
        { id: 'PRJ-2024-001', name: '紫坪铺水库加固工程', role: '中标单位', amount: 126000000, date: '2024-03-15' },
        { id: 'PRJ-2024-002', name: '亭子口水利枢纽工程', role: '中标单位', amount: 89000000, date: '2024-05-20' }
      ],
      evaluations: [
        { id: 'EVL-001', projectName: '紫坪铺水库加固工程', score: 95, level: 'A', date: '2024-06-10' }
      ],
      rating: 4.8,
      cooperationCount: 56,
      fulfillRate: 98
    },
    {
      id: 'SUP-2024-0002',
      name: '成都华西物资供应有限公司',
      creditCode: '91510100MA629XXX0Y',
      type: '民营企业',
      legalPerson: '陈强',
      registerAddress: '四川省成都市武侯区人民南路四段1号',
      businessScope: '钢材、水泥、建筑材料销售',
      status: 'approved',
      category: 'material',
      categoryLabel: '物资采购',
      registerDate: '2024-02-10',
      approveDate: '2024-02-15',
      contacts: [
        { name: '刘伟', phone: '13900139001', email: 'liuwei@huaxi.com', isMain: true }
      ],
      qualifications: [
        { name: '营业执照', fileUrl: '/files/license2.pdf', uploadDate: '2024-02-10', expireDate: '2028-06-30' }
      ],
      projects: [],
      evaluations: [],
      rating: 4.9,
      cooperationCount: 128,
      fulfillRate: 99
    },
    {
      id: 'SUP-2024-0003',
      name: '四川智水科技有限公司',
      creditCode: '91510000MA630XXX0Z',
      type: '民营企业',
      legalPerson: '赵敏',
      registerAddress: '四川省成都市锦江区东大街258号',
      businessScope: '软件开发、信息系统集成服务、信息技术咨询',
      status: 'approved',
      category: 'service',
      categoryLabel: '服务采购',
      registerDate: '2024-03-01',
      approveDate: '2024-03-06',
      contacts: [
        { name: '孙涛', phone: '13700137001', email: 'suntao@zhishui.com', isMain: true }
      ],
      qualifications: [
        { name: '营业执照', fileUrl: '/files/license3.pdf', uploadDate: '2024-03-01', expireDate: '2029-12-31' },
        { name: '软件企业认定证书', fileUrl: '/files/qual3.pdf', uploadDate: '2024-03-01', expireDate: '2026-06-30' }
      ],
      projects: [],
      evaluations: [],
      rating: 4.7,
      cooperationCount: 32,
      fulfillRate: 97
    },
    {
      id: 'SUP-2024-0004',
      name: '四川宏达水利工程有限公司',
      creditCode: '91510000MA631XXX0A',
      type: '民营企业',
      legalPerson: '周刚',
      registerAddress: '四川省绵阳市涪城区临园路东段68号',
      businessScope: '水利工程施工、机电设备安装',
      status: 'pending',
      category: 'engineering',
      categoryLabel: '工程建设',
      registerDate: '2024-05-20',
      contacts: [
        { name: '吴丽', phone: '13600136001', email: 'wuli@hongda.com', isMain: true }
      ],
      qualifications: [
        { name: '营业执照', fileUrl: '/files/license4.pdf', uploadDate: '2024-05-20', expireDate: '2027-06-30' }
      ],
      projects: [],
      evaluations: [],
      rating: 0,
      cooperationCount: 0,
      fulfillRate: 0
    },
    {
      id: 'SUP-2024-0005',
      name: '成都诚信建材有限公司',
      creditCode: '91510100MA632XXX0B',
      type: '民营企业',
      legalPerson: '郑华',
      registerAddress: '四川省成都市金牛区一环路北一段99号',
      businessScope: '建筑材料、装饰材料销售',
      status: 'rejected',
      category: 'material',
      categoryLabel: '物资采购',
      registerDate: '2024-04-15',
      contacts: [
        { name: '钱明', phone: '13500135001', email: 'qianming@chengxin.com', isMain: true }
      ],
      qualifications: [],
      projects: [],
      evaluations: [],
      rejectReason: '资质材料不完整，缺少安全生产许可证',
      rating: 0,
      cooperationCount: 0,
      fulfillRate: 0
    }
  ])

  // 计算属性
  const approvedSuppliers = computed(() =>
    mockSuppliers.value.filter(s => s.status === 'approved')
  )

  const pendingSuppliers = computed(() =>
    mockSuppliers.value.filter(s => s.status === 'pending')
  )

  // 方法
  const getSupplierById = (id) => {
    return mockSuppliers.value.find(s => s.id === id)
  }

  const updateSupplierStatus = (id, status, reason = '') => {
    const supplier = mockSuppliers.value.find(s => s.id === id)
    if (supplier) {
      supplier.status = status
      if (reason) supplier.rejectReason = reason
      if (status === 'approved') {
        supplier.approveDate = new Date().toISOString().split('T')[0]
      }
    }
  }

  const addSupplier = (supplier) => {
    const newId = `SUP-2024-${String(mockSuppliers.value.length + 1).padStart(4, '0')}`
    mockSuppliers.value.push({
      ...supplier,
      id: newId,
      status: 'pending',
      registerDate: new Date().toISOString().split('T')[0],
      projects: [],
      evaluations: [],
      rating: 0,
      cooperationCount: 0,
      fulfillRate: 0
    })
    return newId
  }

  return {
    suppliers,
    currentSupplier,
    loading,
    statistics,
    pendingAudits,
    pendingChanges,
    mockSuppliers,
    approvedSuppliers,
    pendingSuppliers,
    getSupplierById,
    updateSupplierStatus,
    addSupplier
  }
})