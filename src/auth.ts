import { env } from "@/lib/env";
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { prisma } from "@/lib/prisma";

const providers: NextAuthConfig["providers"] = [];

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Auth.js refuses to link a new OAuth account to an existing user
      // (matched by email) by default, surfacing as
      // `?error=OAuthAccountNotLinked` on the sign-in page. This is only
      // unsafe when the OAuth provider doesn't verify emails — Google
      // always does, so allowing the link is the standard fix and lets
      // users who first signed up via magic-link continue with Google.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

// Magic-link / SMTP sign-in (Nodemailer provider) was removed on 2026-05-16:
// Gmail SMTP from Vercel datacenter IPs was unreliable (datacenter IP
// reputation), and Google OAuth covers the same audience without the
// deliverability tail. EMAIL_SERVER_* + EMAIL_FROM are kept on Vercel for
// any future transactional-email path but no longer drive sign-in.
// See `docs/auth.md` (if added) or commit history for the rationale.

/** One-click local sign-in when `next dev` + DEV_AUTH_EMAIL (never enabled in production builds). */
if ((process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && env.DEV_AUTH_EMAIL) {
  const devEmail = env.DEV_AUTH_EMAIL.trim().toLowerCase();
  const devRole = env.DEV_AUTH_ROLE ?? "USER";
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Local dev",
      credentials: {},
      async authorize() {
        let user = await prisma.user.findUnique({
          where: { email: devEmail },
        });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: devEmail,
              emailVerified: new Date(),
              name: "Local Dev",
              nickName: "Dev",
              role: devRole,
            },
          });
        } else if (user.role !== devRole) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { role: devRole },
          });
        }
        return {
          id: user.id,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          role: user.role,
          nickName: user.nickName ?? undefined,
        };
      },
    }),
  );
}

if (env.E2E_AUTH_EMAIL && env.E2E_AUTH_TOKEN) {
  const e2eEmail = env.E2E_AUTH_EMAIL.trim().toLowerCase();
  const e2eRole = env.E2E_AUTH_ROLE ?? "ADMIN";
  providers.push(
    Credentials({
      id: "e2e-login",
      name: "Production E2E",
      credentials: {
        email: { label: "Email", type: "email" },
        token: { label: "Token", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const token = String(credentials?.token ?? "");
        if (!email || !token) return null;
        if (email !== e2eEmail || token !== env.E2E_AUTH_TOKEN) return null;

        let user = await prisma.user.findUnique({
          where: { email: e2eEmail },
        });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: e2eEmail,
              emailVerified: new Date(),
              name: "E2E Admin",
              nickName: "E2E",
              role: e2eRole,
            },
          });
        } else if (user.role !== e2eRole) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { role: e2eRole },
          });
        }

        return {
          id: user.id,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          role: user.role,
          nickName: user.nickName ?? undefined,
        };
      },
    }),
  );
}

const authConfig = {
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role || "USER";
        token.nickName = (user as { nickName?: string }).nickName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.sub as string;
        (session.user as { role: string }).role = token.role as string;
        (session.user as { nickName?: string }).nickName =
          token.nickName as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
    error: "/auth/error",
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  ...authConfig,
});
