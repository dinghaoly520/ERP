"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useConfirm } from "@/components/use-confirm";

/**
 * 离开守卫（React 版）— 移植自 Vue useRouteLeaveGuard / createDialogLeaveGuard。
 *
 * useLeaveGuard(dirty) 返回 { leaveGuardDialog }，消费组件须渲染该节点：
 *  - 浏览器级关闭/刷新/外链跳转 → beforeunload（浏览器原生机制，样式无法自定义——
 *    各浏览器一律弹系统级提示，这是平台约束而非设计选择）；
 *  - 站内 SPA 路由跳转 → 门户样式化确认弹窗（use-confirm，gdlg 壳）。
 *    2026-11-06 用户裁定「全系统弃原生 window.confirm」重构：
 *    · pushState/replaceState 拦截：吞掉本次调用，弹窗确认后 bypass 重放原始参数
 *      （取消则不重放，停留原页）；
 *    · popstate（后退/前进）：先同步弹回原位（防目的地闪现），再弹窗确认；
 *      确认后 allowNextPop 放行一次 history.back()，取消则原地不动。
 */
export function useLeaveGuard(
  dirty: boolean | (() => boolean),
  message = "当前有未保存的修改，离开后会丢失。确定离开吗？",
): { leaveGuardDialog: ReactNode } {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 门户样式化确认（gdlg 壳）：confirm 稳定引用（useCallback 空依赖），可安全进 history 闭包
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    const isDirty = () => (typeof dirtyRef.current === "function" ? dirtyRef.current() : dirtyRef.current);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };

    // 拦截 SPA 导航：Next App Router 的 <Link>/router.push 最终调 history.pushState
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    let bypass = false;
    // 异步确认放行的回退导航（popstate 不再拦截一次）
    let allowNextPop = false;
    // 弹窗期间挂起的待确认导航（弹窗被新确认替换/组件卸载时按取消处理，不重放）
    let settled = false;

    const guardNav = (orig: (...args: unknown[]) => void) => {
      return (...args: unknown[]) => {
        if (bypass || !isDirty()) {
          bypass = false;
          return orig(...args);
        }
        // 吞掉本次导航，样式化弹窗确认后再重放原始参数
        settled = false;
        void confirm({ title: "离开确认", message }).then((ok) => {
          if (settled) return;
          settled = true;
          if (ok) {
            bypass = true;
            orig(...args);
          }
          // 取消：不重放，停留原页
        });
      };
    };

    const guardedPush = guardNav(origPush as (...args: unknown[]) => void) as typeof history.pushState;
    const guardedReplace = guardNav(origReplace as (...args: unknown[]) => void) as typeof history.replaceState;

    // B4-1（2026-09-30）：抑制「拒绝后回弹」触发的第二次 popstate——此前 forward() 回到原位
    // 会再触发一次 onPopState：一次 Back 要连按两次取消，且第二次点「确定（离开）」时
    // 实际已 forward 回原位（确认语义失效）。
    let suppressBouncePop = false;
    const onPopState = () => {
      if (suppressBouncePop) {
        suppressBouncePop = false;
        return;
      }
      if (allowNextPop) {
        allowNextPop = false;
        return;
      }
      if (!isDirty()) return;
      // 先同步弹回原位（目的地不闪现），再样式化弹窗确认（2026-11-06 替代原生 confirm）
      suppressBouncePop = true;
      history.forward();
      settled = false;
      void confirm({ title: "离开确认", message }).then((ok) => {
        if (settled) return;
        settled = true;
        if (ok) {
          allowNextPop = true;
          history.back();
        }
      });
    };

    history.pushState = guardedPush;
    history.replaceState = guardedReplace;
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);

    return () => {
      // 卸载时挂起中的确认按取消结算（不重放导航），并还原 history 原方法
      settled = true;
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [message, confirm]);

  return { leaveGuardDialog: dialog };
}
