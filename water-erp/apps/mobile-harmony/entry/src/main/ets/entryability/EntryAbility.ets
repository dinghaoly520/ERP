import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const TAG: string = 'SsycCockpit';

/**
 * 驾驶舱壳应用入口 Ability——单页 Web 壳（pages/Index 载入 :3011）。
 * 窗口不做沉浸式（默认避让状态栏/导航条）：Web 内容不落在系统条下方，
 * 页面内 env(safe-area-inset-*) 退化为 0、由 max() 兜底距，无需壳侧注入。
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, 'onCreate');
  }

  onDestroy(): void {
    hilog.info(0x0000, TAG, 'onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 窗口底色对齐页面背景（#f4f6fa = 页面 viewport themeColor）：冷启动与
    // 键盘弹出间隙不闪白；页面同色过渡无感
    try {
      windowStage.getMainWindowSync().setWindowBackgroundColor('#f4f6fa');
    } catch (e) {
      hilog.warn(0x0000, TAG, 'setWindowBackgroundColor failed');
    }
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, TAG, 'loadContent failed: %{public}d', err.code);
        return;
      }
      hilog.info(0x0000, TAG, 'loadContent ok');
    });
  }

  onWindowStageDestroy(): void {
    // 壳随 Web 生命周期收尾，无自有资源
  }

  onForeground(): void {
    // 前台恢复：Web 自动续跑（页面自带 30s 轮询回前台即刷逻辑）
  }

  onBackground(): void {
    // 退后台：系统冻结渲染，cookie/本地存储持久
  }
}
