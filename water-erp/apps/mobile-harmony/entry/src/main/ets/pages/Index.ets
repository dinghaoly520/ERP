import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * 蜀水云采·移动驾驶舱 —— 鸿蒙壳页（网页转 App，2026-11-25 用户裁定）。
 * ArkWeb 载入 :3011，登录态=WebView cookie（token_web）持久化 + 页面 sessionStorage，
 * 冷启动免登录（:3011 proxy 闸按 cookie 放行）；零后端改动。
 *
 * 唯一上线前必改配置：APP_URL（下方常量）。
 */

/** 驾驶舱服务地址：
 *  联调 = 局域网 :3011（http 明文仅限内网开发；剪贴板等安全上下文 Web 能力
 *         已在 :3011 copy-to-clipboard 内建 execCommand 降级，可用）；
 *  生产 = 域名 https://mobile-ssyc.scsfjt.com（上架 AppGallery 必须 https——
 *         生产 cookie 恒 Secure，http 载入会丢登录态） */
const APP_URL: string = 'https://mobile-ssyc.scsfjt.com';

const TAG: string = 'SsycCockpit';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State progress: number = 0;
  @State failed: boolean = false;
  @State errorText: string = '';

  /** 返回手势/物理键：Web 可后退（板块间跳转、登录流内退）则站内后退，
   *  根页返回交系统默认（退后台不杀进程） */
  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (e) {
      // controller 未 attach（极早退）交系统
      hilog.warn(0x0000, TAG, 'onBackPress: controller not attached');
    }
    return false;
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Web({ src: APP_URL, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true) // sessionStorage（X-Web-Token 头）与 localStorage
        .databaseAccess(true)
        .zoomAccess(false) // 页面已做三档屏幕自适应，禁捏合缩放
        .overviewModeAccess(false)
        .onControllerAttached(() => {
          // UA 追加壳标记：服务端/前端可识别 App 流量（观测用，无鉴权语义）。
          // API 26 无 controller.setUserAgent——走静态 setAppCustomUserAgent 设 App 级默认
          try {
            const ua: string = this.controller.getUserAgent();
            webview.WebviewController.setAppCustomUserAgent(`${ua} SsycCockpitHarmony/1.0`);
          } catch (e) {
            hilog.warn(0x0000, TAG, 'setAppCustomUserAgent failed');
          }
        })
        .onProgressChange((data) => {
          this.progress = data.newProgress;
        })
        .onPageBegin(() => {
          // 任意成功加载（含站内跳转）即摘错误层
          this.failed = false;
        })
        .onPageEnd(() => {
          this.progress = 100;
        })
        .onErrorReceive((event) => {
          // 主文档网络错误（断网/服务未起）→ 覆盖层；子资源失败不拦
          if (event) {
            if (event.request.isMainFrame()) {
              this.failed = true;
              this.errorText = event.error.getErrorInfo();
              hilog.error(0x0000, TAG, 'main frame error: %{public}s', this.errorText);
            }
          }
        })
        .onHttpErrorReceive((event) => {
          // 主文档 4xx/5xx（服务起了但异常）→ 同样落覆盖层
          if (event && event.request.isMainFrame()) {
            this.failed = true;
            this.errorText = `HTTP ${event.response.getResponseCode()}`;
          }
        })

      // 顶部加载进度条（加载中才显示）
      if (this.progress > 0 && this.progress < 100 && !this.failed) {
        Progress({ value: this.progress, total: 100, type: ProgressType.Linear })
          .width('100%')
          .height(2)
          .color('#064ea2')
      }

      // 主文档失败覆盖层：离线/服务未起 → 重试
      if (this.failed) {
        Column() {
          Text('连接不上服务')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor('#1f2937')
          Text(this.errorText !== '' ? this.errorText : '请检查网络或服务地址')
            .fontSize(14)
            .fontColor('#6b7280')
            .margin({ top: 8 })
          Button('重试')
            .margin({ top: 24 })
            .backgroundColor('#064ea2')
            .onClick(() => {
              this.failed = false;
              try {
                this.controller.refresh();
              } catch (e) {
                // 冷启动即失败时 controller 可能未 attach——整页重载
                this.controller.loadUrl(APP_URL);
              }
            })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#f4f6fa')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f4f6fa')
  }
}
