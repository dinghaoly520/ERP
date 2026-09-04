"use client";
/* U盾在场探测（严格模式）：PIN 弹窗打开期间轮询 vendor 中间件——在线且有盾才算在场。
 * present=false 时弹窗应以「未检测到 U盾」占位替换 PIN 表单（插回后 ≤2s 自动恢复）。
 * 非严格模式返回 null：mock 回落轨道不拦（CI/开发保底不变）。 */
import { useEffect, useState } from "react";
import { VendorUKeyAdapter } from "@water-erp/ukey";
import { UKEY_STRICT } from "./ukey-factory";

export function useUkeyPresence(enabled: boolean, pollMs = 2000): boolean | null {
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled || !UKEY_STRICT) return;
    let alive = true;
    const tick = async () => {
      const h = await VendorUKeyAdapter.probe();
      if (alive) setPresent(!!h && h.shields > 0);
    };
    void tick();
    const timer = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled, pollMs]);
  return UKEY_STRICT ? present : null;
}
