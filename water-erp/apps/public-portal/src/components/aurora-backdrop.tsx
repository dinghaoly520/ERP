/**
 * 动态变色页面背景（2026-10-21 集团简介/联系我们）：品牌蓝系「极光」色幕——
 * 底色冷暖双相交叉淡入 + 三团柔光缓慢漂移，页面背景色随时间（~36s 周期）往复变化。
 * 仅合成器动画（transform/opacity），无逐帧重绘；prefers-reduced-motion 时冻结。
 * 仅供单页挂载，勿放进全局 .flow-page（其余页面保持静态底色）。
 */
export function AuroraBackdrop() {
  return (
    <div className="aurora-backdrop" aria-hidden>
      {/* 底色双层：冷/暖两相位交叉淡入——色相变化的主载体 */}
      <span className="aurora-base aurora-base--cool" />
      <span className="aurora-base aurora-base--dusk" />
      {/* 柔光三团：品牌蓝域内三个色相，缓慢漂移 */}
      <span className="aurora-blob aurora-blob--a" />
      <span className="aurora-blob aurora-blob--b" />
      <span className="aurora-blob aurora-blob--c" />
    </div>
  );
}
