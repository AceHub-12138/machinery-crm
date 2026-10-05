import { XiaochuanChat } from "@/components/xiaochuan/XiaochuanChat";
import { XiaochuanLogin } from "@/components/xiaochuan/xiaochuan-login";
import { getXiaochuanViewer, toViewerView } from "@/lib/agent/auth";

// 页面内容完全依赖登录会话，按动态渲染，不做静态预生成
export const dynamic = "force-dynamic";

/**
 * 双状态入口：
 * - 未登录（既无 CRM 会话也无 Agent 账号 Cookie）→ 登录界面（左表单右机器人）；
 * - 已登录（CRM 员工平台内跳转免登录 / Agent 账号已登录）→ 直接进对话界面。
 */
export default async function XiaochuanPage() {
  const viewer = await getXiaochuanViewer();
  if (!viewer) return <XiaochuanLogin />;
  return <XiaochuanChat viewer={toViewerView(viewer)} />;
}
