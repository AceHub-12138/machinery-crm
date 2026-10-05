import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcryptjs from "bcryptjs";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/rate-limit";

// 部署 ai.dachuan.pro 子域名时设置 AUTH_COOKIE_DOMAIN=.dachuan.pro，
// 让 CRM 与 Agent 平台跨子域共享登录态（平台内跳转免登录）；不设置则维持本站 Cookie。
// 注意：设置后必须用 dachuan.pro 域名访问平台，IP 直连将无法保持登录。
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") || process.env.NODE_ENV === "production";
const cookiePrefix = useSecureCookies ? "__Secure-" : "";
const sharedCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}next-auth.session-token`,
      options: {
        domain: sharedCookieDomain,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        // 显式保持 NextAuth 默认的 30 天免登录（自定义 options 时必须自己带上）
        maxAge: 30 * 24 * 60 * 60,
      },
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim();
        const password = String(credentials.password);
        const rateLimitKey = email.toLowerCase();
        const rateLimit = checkLoginRateLimit(rateLimitKey);

        if (!rateLimit.allowed) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.isActive) {
          recordLoginFailure(rateLimitKey);
          return null;
        }

        const isPasswordValid = await bcryptjs.compare(
          password,
          user.password
        );

        if (!isPasswordValid) {
          recordLoginFailure(rateLimitKey);
          return null;
        }

        resetLoginRateLimit(rateLimitKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          region: user.region,
          territories: (user as any).territories ?? [],
          viewScope: (user as any).viewScope ?? "TERRITORY",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.region = (user as any).region;
        token.territories = (user as any).territories ?? [];
        token.viewScope = (user as any).viewScope ?? "TERRITORY";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
        (session.user as any).region = token.region;
        (session.user as any).territories = (token as any).territories ?? [];
        (session.user as any).viewScope = (token as any).viewScope ?? "TERRITORY";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 保持登录 30 天
  },
});
