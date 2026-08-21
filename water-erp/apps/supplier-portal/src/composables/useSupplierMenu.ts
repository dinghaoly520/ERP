import { computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import {
  HomeFilled, OfficeBuilding, EditPen, Document, DocumentChecked,
  Bell, ChatDotRound, Goods, Connection, Box, Key,
} from '@element-plus/icons-vue'

// X-1：集中供应商菜单权限逻辑。当前基于 isTemporary 布尔分支，后续扩展为权限矩阵时只需改此文件。
export function useSupplierMenu() {
  const supplierStore = useSupplierStore()
  const isTemp = computed(() => !!supplierStore.status?.isTemporary)

  const menuItems = computed(() => {
    const items: any[] = [
      { path: '/dashboard', title: '业务工作台', icon: HomeFilled, desc: '状态与待办总览' },
      { divider: true, label: '投标中心' },
      { path: '/bids', title: '可投标项目', icon: Document, desc: '发现可参与项目' },
      { path: '/my-bids', title: '投标进展', icon: DocumentChecked, desc: '跟踪已投项目' },
    ]
    if (!isTemp.value) {
      items.push(
        { divider: true, label: '供货合作' },
        { path: '/catalog', title: '采购目录', icon: Goods, desc: '浏览品类并申请供货' },
        { path: '/catalog-applications', title: '供货申请', icon: Connection, desc: '申请进度与议价' },
        { path: '/supply', title: '我的供货', icon: Box, desc: '已准入品类与报价' },
        { divider: true, label: '企业档案' },
        { path: '/profile', title: '企业信息', icon: OfficeBuilding, desc: '主体资料、资质与联系人' },
        { path: '/profile/ukey', title: 'U盾管理', icon: Key, desc: '投标加密证书与介质' },
        { path: '/change-records', title: '申请记录', icon: EditPen, desc: '变更审核进度' },
      )
    }
    items.push(
      { divider: true, label: '信息中心' },
      { path: '/announcements', title: '公告公示', icon: Bell, desc: '公告与政策' },
      { path: '/notifications', title: '消息通知', icon: ChatDotRound, badge: true, desc: '平台消息' },
    )
    return items
  })

  return { menuItems }
}
