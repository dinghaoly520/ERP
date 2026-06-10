import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  // 当前用户信息
  const currentUser = ref({
    id: 'USR-001',
    name: '管理员',
    role: 'admin', // supplier, purchaser, admin, leader
    roleName: '系统管理员',
    department: '采购中心',
    avatar: '',
    permissions: ['all']
  })

  // 用户角色配置
  const roles = [
    { value: 'supplier', label: '供应商用户', description: '注册、资料维护、投标参与' },
    { value: 'purchaser', label: '采购中心员工', description: '供应商审核、评价管理' },
    { value: 'admin', label: '系统管理员', description: '系统配置、权限维护' },
    { value: 'leader', label: '领导', description: '查询和监管' }
  ]

  // 待办事项
  const todos = ref([
    {
      id: 1,
      title: '四川宏达水利工程有限公司注册审核',
      type: 'audit',
      priority: 'high',
      createTime: '2024-05-20 14:30',
      status: 'pending'
    },
    {
      id: 2,
      title: '四川川水建设工程有限公司信息变更审核',
      type: 'change',
      priority: 'medium',
      createTime: '2024-05-19 10:15',
      status: 'pending'
    },
    {
      id: 3,
      title: '紫坪铺水库加固工程供应商评价',
      type: 'evaluation',
      priority: 'medium',
      createTime: '2024-05-18 16:45',
      status: 'pending'
    },
    {
      id: 4,
      title: '成都华西物资供应有限公司资质到期提醒',
      type: 'expire',
      priority: 'low',
      createTime: '2024-05-17 09:00',
      status: 'pending'
    }
  ])

  // 通知消息
  const notifications = ref([
    {
      id: 1,
      title: '供应商注册审核通过',
      content: '四川智水科技有限公司注册审核已通过，已进入供应商库。',
      type: 'success',
      read: false,
      time: '2024-05-20 15:30'
    },
    {
      id: 2,
      title: '资质材料即将到期',
      content: '成都华西物资供应有限公司的营业执照将于30天后到期，请及时提醒更新。',
      type: 'warning',
      read: false,
      time: '2024-05-20 10:00'
    },
    {
      id: 3,
      title: '异常记录待处理',
      content: '四川某建筑工程有限公司存在提交虚假材料的异常行为，请及时处理。',
      type: 'error',
      read: true,
      time: '2024-05-19 16:20'
    }
  ])

  // 计算属性
  const unreadCount = computed(() =>
    notifications.value.filter(n => !n.read).length
  )

  const pendingTodoCount = computed(() =>
    todos.value.filter(t => t.status === 'pending').length
  )

  // 方法
  const switchRole = (role) => {
    const roleConfig = roles.find(r => r.value === role)
    if (roleConfig) {
      currentUser.value.role = role
      currentUser.value.roleName = roleConfig.label
    }
  }

  const markNotificationRead = (id) => {
    const notification = notifications.value.find(n => n.id === id)
    if (notification) {
      notification.read = true
    }
  }

  const markAllNotificationsRead = () => {
    notifications.value.forEach(n => n.read = true)
  }

  const completeTodo = (id) => {
    const todo = todos.value.find(t => t.id === id)
    if (todo) {
      todo.status = 'completed'
    }
  }

  const hasPermission = (permission) => {
    if (currentUser.value.permissions.includes('all')) return true
    return currentUser.value.permissions.includes(permission)
  }

  return {
    currentUser,
    roles,
    todos,
    notifications,
    unreadCount,
    pendingTodoCount,
    switchRole,
    markNotificationRead,
    markAllNotificationsRead,
    completeTodo,
    hasPermission
  }
})