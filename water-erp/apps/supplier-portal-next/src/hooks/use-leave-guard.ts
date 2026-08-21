"use client";

import { useEffect, useRef } from "react";

/**
 * 离开守卫（React 版）— 移植自 Vue useRouteLeaveGuard / createDialogLeaveGuard。
 *
 * useLeaveGuard(dirty)：
 *  - 浏览器级关闭/刷新/外链跳转 → beforeunload 原生确认
 *  - 站内 SPA 路由跳转（Next Link / router.push 走 history.pushState）→ 拦截后原生 confirm
 *    （ElMessageBox 样式确认框在同步拦截语义下无法复刻，以原生 confirm 保功能等价）
 *
 * confirmDiscard()：弹窗关闭守卫（对话框场景）用的 Promise 化确认，由调用方配合样式化弹窗使用。
 */
export function useLeaveGuard(
  dirty: boolean | (() => boolean),
  message = "当前有未保存的修改，离开后会丢失。确定离开吗？",
) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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

    const guardNav = (orig: (...args: unknown[]) => void) => {
      return (...args: unknown[]) => {
        if (bypass || !isDirty()) {
          bypass = false;
          return orig(...args);
        }
        if (window.confirm(message)) {
          bypass = true;
          return orig(...args);
        }
        // 拒绝离开：不执行原始导航。App Router 在 popstate 场景下会自行前进，
        // pushState 场景直接吞掉即可。
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guardedPush = guardNav(origPush as (...args: unknown[]) => void) as typeof history.pushState;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guardedReplace = guardNav(origReplace as (...args: unknown[]) => void) as typeof history.replaceState;

    const onPopState = () => {
      if (isDirty() && !window.confirm(message)) {
        // 拒绝后回弹：把用户按回原位置（前进到被拒绝的目的地再退回）
        history.forward();
      }
    };

    history.pushState = guardedPush;
    history.replaceState = guardedReplace;
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
}
