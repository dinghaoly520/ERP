import type { MetadataRoute } from "next";

/** PWA 可安装（2026-10-27）：领导「添加到主屏幕」免输地址。standalone 无浏览器栏。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "蜀水云采·专属驾驶舱",
    short_name: "蜀水驾驶舱",
    description: "领导视角的采购数据驾驶舱：数据库/台账/进展/水叮当",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#f4f6fa",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
