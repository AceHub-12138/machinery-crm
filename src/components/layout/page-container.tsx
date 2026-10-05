import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  variant?: "dashboard" | "data" | "form";
};

const WIDTH_BY_VARIANT = {
  dashboard: "max-w-[1440px]",
  data: "max-w-none",
  form: "max-w-4xl",
} as const;

export function PageContainer({
  children,
  className,
  variant = "dashboard",
}: PageContainerProps) {
  return (
    <div className={cn("mx-auto w-full", WIDTH_BY_VARIANT[variant], className)}>
      {children}
    </div>
  );
}
