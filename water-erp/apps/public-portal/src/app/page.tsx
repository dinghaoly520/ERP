import HomeClient from './home-client';
import { fetchAnnouncementsServer } from '@/lib/announcements';
import { apiOrigin } from '@water-erp/config';

// 首页公告由服务端预取并随 HTML 下发，不再依赖客户端 fetch：
// 这样浏览器后退(bfcache)、整页刷新、或客户端 JS 异常时，公告仍可直接从 HTML 渲染。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiBase = process.env.API_BASE_URL || apiOrigin();
  const initialAnnouncements = await fetchAnnouncementsServer(apiBase);
  return <HomeClient initialAnnouncements={initialAnnouncements} />;
}
