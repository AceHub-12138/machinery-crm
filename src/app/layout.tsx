import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Script from "next/script";

const themeInitScript = `
  (function () {
    var mode = "system";
    try {
      var stored = window.localStorage.getItem("dachuan.theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        mode = stored;
      }
    } catch (e) {}

    var prefersDark = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
    var root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.classList.toggle("dark", resolved === "dark");
  })();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DachuanPro-CRM",
  description: "大川机床客户关系管理系统",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DachuanPro",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />

        <Script id="crypto-randomuuid-polyfill" strategy="beforeInteractive">

        {`

          (function () {

            if (typeof window === "undefined") return;

            var c = window.crypto;

            if (!c || c.randomUUID) return;

            var makeId = function () {

              return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {

                var r = Math.random() * 16 | 0;

                var v = ch === "x" ? r : (r & 3 | 8);

                return v.toString(16);

              });

            };

            try {

              Object.defineProperty(c, "randomUUID", {

                value: makeId,

                configurable: true

              });

            } catch (e) {

              c.randomUUID = makeId;

            }

          })();

        `}

        </Script>
      </head>

      <body className="min-h-full bg-[var(--app-bg)] [background-image:var(--app-bg-glow)] text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
