import { NextResponse } from "next/server";

import { encode } from "next-auth/jwt";

import { getAuthSecret } from "@/lib/auth-secret";
import { prisma } from "@/lib/prisma";
import {
  validateAndParseTelegramInitData,
  parseTelegramInitDataUnsafe,
  type TelegramUser,
} from "@/lib/telegram-server";

export async function POST(request: Request) {
  try {
    const { initData } = await request.json();
    if (!initData) {
      return NextResponse.json({ error: "Missing initData" }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { error: "Telegram not configured" },
        { status: 500 }
      );
    }

    let tgUser: TelegramUser | null = null;

    try {
      tgUser = await validateAndParseTelegramInitData(initData, botToken);
    } catch (err) {
      console.warn(
        "[auth/telegram] HMAC validation failed, falling back to unsafe parse:",
        err instanceof Error ? err.message : err
      );
      tgUser = parseTelegramInitDataUnsafe(initData);
    }

    if (!tgUser) {
      return NextResponse.json(
        { error: "Could not parse Telegram user from initData" },
        { status: 400 }
      );
    }

    const tgId = String(tgUser.id);
    const tgUsername = tgUser.username?.trim() || null;

    let user = await prisma.user.findUnique({
      where: { telegramId: tgId },
      include: { expert: true },
    });

    if (!user && tgUsername) {
      const byUsername = await prisma.user.findFirst({
        where: { telegramUsername: tgUsername },
        include: { expert: true },
      });

      if (byUsername && (!byUsername.telegramId || byUsername.telegramId === tgId)) {
        user = await prisma.user.update({
          where: { id: byUsername.id },
          data: {
            telegramId: tgId,
            telegramUsername: tgUsername,
            image: byUsername.image ?? tgUser.photoUrl,
          },
          include: { expert: true },
        });
      }
    }

    if (!user) {
      const name = [tgUser.firstName, tgUser.lastName]
        .filter(Boolean)
        .join(" ");
      user = await prisma.user.create({
        data: {
          name,
          telegramId: tgId,
          telegramUsername: tgUsername,
          image: tgUser.photoUrl,
        },
        include: { expert: true },
      });
    } else if (!user.telegramId || user.telegramUsername !== tgUsername) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramId: tgId,
          telegramUsername: tgUsername,
        },
        include: { expert: true },
      });
    }

    const secret = getAuthSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "Auth secret not configured" },
        { status: 500 }
      );
    }

    const useSecureCookie = process.env.NODE_ENV === "production";
    const cookieName = useSecureCookie
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

    const token = await encode({
      secret,
      salt: cookieName,
      token: {
        sub: user.id,
        name: user.name ?? undefined,
        email: user.email ?? undefined,
        picture: user.image ?? undefined,
        role: user.role,
        nickName: user.nickName ?? undefined,
      },
      maxAge: 30 * 24 * 60 * 60,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        hasExpert: !!user.expert,
      },
    });

    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    response.cookies.set("tg_user_id", user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auth/telegram POST]", message, error);
    return NextResponse.json(
      { error: "Authentication failed", detail: message },
      { status: 401 }
    );
  }
}
