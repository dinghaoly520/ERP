import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessageBox } from 'element-plus'

async function confirmDiscard(message: string, confirmText: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, '离开确认', {
      confirmButtonText: confirmText, cancelButtonText: '继续编辑', type: 'warning',
    })
    return true
  } catch { return false }
}

export function useRouteLeaveGuard(
  dirty: Ref<boolean>,
  message = '当前有未保存的修改，离开后会丢失。确定离开吗？',
) {
  onBeforeRouteLeave(async () => {
    if (!dirty.value) return true
    return confirmDiscard(message, '离开')
  })
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!dirty.value) return
    e.preventDefault(); e.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}

export function createDialogLeaveGuard(
  dirty: Ref<boolean>,
  message = '当前有未保存的修改，关闭后会丢失。确定关闭吗？',
) {
  return async (done: () => void) => {
    if (!dirty.value) { done(); return }
    if (await confirmDiscard(message, '放弃')) done()
  }
}
