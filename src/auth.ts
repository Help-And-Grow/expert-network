import { env } from "@/lib/env";
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";

import { maskEmailForLog } from "@/lib/auth-log";
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

if (env.EMAIL_SERVER_HOST && env.EMAIL_FROM) {
  const nodemailerProvider = Nodemailer({
    server: {
      host: env.EMAIL_SERVER_HOST,
      port: parseInt(env.EMAIL_SERVER_PORT || "587", 10),
      auth: {
        user: env.EMAIL_SERVER_USER,
        pass: env.EMAIL_SERVER_PASSWORD,
      },
    },
    from: env.EMAIL_FROM,
  });
  providers.push({
    ...nodemailerProvider,
    async sendVerificationRequest(params) {
      const hint = maskEmailForLog(params.identifier);
      console.log("[auth] Magic link: sendVerificationRequest start", {
        to: hint,
        host: env.EMAIL_SERVER_HOST,
      });
      try {
        await nodemailerProvider.sendVerificationRequest!(params);
        console.log("[auth] Magic link: SMTP send finished OK", { to: hint });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[auth] Magic link send failed:", { to: hint, message: msg });
        throw err;
      }
    },
  });
}

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
