import "@/components/screen/sales-screen.css";

/**
 * /screen 独立布局。
 *
 * 大屏路由脱离平台 AppShell、侧边栏与登录布局；
 * 样式在独立文件里以 .sales-screen-root 作用域隔离，不触碰平台全局。
 */
export default function ScreenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
