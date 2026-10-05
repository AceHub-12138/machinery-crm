import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { canAccessCrmDashboard, canAccessErpDashboard, dashboardHomeForRole } from "@/lib/dashboard-access";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const cronApiRoutes = new Set([
    "/api/erp/delivery-reminders/run",
    "/api/erp/kit-rechecks/process",
  ]);

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // 桌面客户端下载与版本信息：公开（未登录新员工要能下载；更新器不带会话 Cookie）
    pathname.startsWith("/api/downloads") ||
    pathname === "/api/desktop/latest" ||
    (pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) ||
    pathname === "/api/agent-gateway/chat" ||
    cronApiRoutes.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/logo.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  // 小川独立站：登录态由页面/接口自行识别（CRM 会话或 Agent 独立账号 Cookie），
  // 未登录不再强制跳 CRM 登录页——Agent 平台有自己的登录界面。
  // /api/agent/* 匿名可达但接口内部双身份校验，无身份一律 401。
  if (pathname === "/xiaochuan" || pathname.startsWith("/api/agent/")) {
    return NextResponse.next();
  }

  // 展厅公开大屏：LED 屏浏览器凭可撤销链接访问，无登录态；
  // 只放行精确的公开页面/数据 API 前缀，失效链接由公开接口统一表现为「大屏不可用」，不跳登录页。
  if (pathname.startsWith("/screen/sales/") || pathname.startsWith("/api/screen/sales/")) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  const role = (req.auth.user as any)?.role;
  const home = dashboardHomeForRole(role);
  const crmDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/crm");
  const erpDashboard = pathname.startsWith("/dashboard/erp");
  const crmDashboardApi = pathname === "/api/dashboard" || pathname.startsWith("/api/crm/dashboard");
  const erpDashboardApi = pathname.startsWith("/api/erp/dashboard");

  if (crmDashboardApi && !canAccessCrmDashboard(role)) return NextResponse.json({ error: "无权限访问 CRM工作台" }, { status: 403 });
  if (erpDashboardApi && !canAccessErpDashboard(role)) return NextResponse.json({ error: "无权限访问 ERP工作台" }, { status: 403 });
  if (crmDashboard && !canAccessCrmDashboard(role)) return NextResponse.redirect(new URL(home || "/login", req.url));
  if (erpDashboard && !canAccessErpDashboard(role)) return NextResponse.redirect(new URL(home || "/login", req.url));

  const matchesPage = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  const rolePages: Record<string, string[]> = {
    PURCHASE: ["/erp/inventory", "/erp/materials", "/erp/bom", "/erp/suppliers", "/erp/purchase-demands", "/erp/purchase-orders", "/erp/production-orders", "/erp/kit-check-results", "/erp/supplier-deliveries", "/erp/monthly-production-plans"],
    WAREHOUSE: ["/erp/inventory", "/erp/materials", "/erp/bom", "/erp/purchase-demands", "/erp/purchase-orders", "/erp/production-orders", "/erp/kit-check-results", "/erp/warehouse", "/erp/stock-in", "/erp/stock-out", "/erp/stock-transfers", "/erp/stock-check", "/erp/supplier-deliveries", "/erp/monthly-production-plans"],
  };

  // 内部 ERP 岗位硬隔离：只允许 ERP + 系统设置 + 小川助手；具体写权限由 API 再校验。
  // 其余页面弹回库存台账,其余接口一律 403,防止泄露客户/合同等机密数据。
  // 小川对话按业务拍板对全员开放（页面 + 会话接口）；其数据查询工具内部仍按角色/区域校验。
  if (role === "WAREHOUSE" || role === "PURCHASE") {
    const warehouseAllowed =
      erpDashboard ||
      pathname.startsWith("/api/erp") ||
      pathname === "/tasks" ||
      pathname === "/tasks/monthly" ||
      pathname.startsWith("/api/system/tasks") ||
      pathname === "/xiaochuan" ||
      pathname.startsWith("/api/agent/") ||
      rolePages[role].some(matchesPage) ||
      pathname.startsWith("/settings") ||
      pathname.startsWith("/api/settings");
    if (!warehouseAllowed) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "无权限访问" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard/erp", req.url));
    }
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/lead-hunter") || pathname.startsWith("/api/lead-hunter") || pathname.startsWith("/api/system/settings") || pathname.startsWith("/api/system/sales-screen/share") || pathname.startsWith("/api/system/permissions") || pathname.startsWith("/api/system/health")) {
    if (role !== "SUPER_ADMIN") {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "无权限访问平台管理" }, { status: 403 });
      return NextResponse.redirect(new URL(home || "/login", req.url));
    }
  }

  if ((role === "SALES" || role === "FOREIGN_TRADE") && (pathname.startsWith("/erp") || pathname.startsWith("/api/erp"))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "无权限访问 ERP" }, { status: 403 });
    return NextResponse.redirect(new URL("/dashboard/crm", req.url));
  }

  // 用户管理仅超级管理员
  if (pathname.startsWith("/users")) {
    if (role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/upload|_next/static|_next/image|favicon.ico).*)",
  ],
};
