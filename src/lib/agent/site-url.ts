/**
 * 小川独立站点地址（供侧边栏跳转按钮使用）。
 * 本地开发默认本站 /xiaochuan；生产部署 ai.dachuan.pro 时在环境变量配置：
 *   NEXT_PUBLIC_XIAOCHUAN_URL=https://ai.dachuan.pro
 * 平台回跳地址同理：NEXT_PUBLIC_PLATFORM_URL（默认 /）。
 */
export const XIAOCHUAN_SITE_URL = process.env.NEXT_PUBLIC_XIAOCHUAN_URL || "/xiaochuan";
export const PLATFORM_HOME_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || "/";
