import type { Metadata } from "next";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "小川助手 | DachuanPro",
  description: "大川机床平台内部 AI 助手：查询 CRM/ERP 数据，现查现答。",
};

// 独立站点布局：不挂平台侧边栏/顶栏（AppShell），自带轻量会话上下文。
// 生产环境将 ai.dachuan.pro 反代到同一应用，本路由即整站。
export default function XiaochuanLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
