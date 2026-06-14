import { redirect } from 'next/navigation';

// 「招标项目管理」已按职责边界移出 3004（开标/评标/归档归在线开评标系统）。
// 此路由仅作兜底：浏览器若缓存了旧侧边栏的链接，点击时优雅跳转而非 404，
// 跳转后会触发整页加载，自动刷新为最新的三中心侧边栏。
export default function Page() {
  redirect('/notice');
}
