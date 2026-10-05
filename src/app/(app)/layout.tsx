import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";

// 悬浮桌宠（FloatingPet）已由全屏「小川助手」页 /xiaochuan 取代，组件保留可随时恢复。
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>
        {children}
      </AppShell>
    </Providers>
  );
}
