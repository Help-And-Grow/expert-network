import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { SignJWT } from "jose";
import { z } from "zod";

import { getAuthSecret } from "@/lib/auth-secret";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET;
const authSecret = getAuthSecret();
const JWT_SECRET = new TextEncoder().encode(
  authSecret || "wechat-fallback-secret"
);

interface Code2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

const wechatAuthBodySchema = z.object({
  code: z.string().trim().min(1),
  nickName: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const rateLimited = checkRateLimit(request, {
      namespace: "auth:wechat",
      limit: 30,
      windowMs: 5 * 60_000,
    });
    if (rateLimited) return rateLimited;

    const parsed = wechatAuthBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { code, nickName, avatarUrl } = parsed.data;

    if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
      return NextResponse.json(
        { error: "WeChat not configured" },
        { status: 500 }
      );
    }

    const wxRes = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData: Code2SessionResponse = await wxRes.json();

    if (wxData.errcode || !wxData.openid) {
      console.error("[wechat-auth] code2session error:", wxData);
      return NextResponse.json(
        { error: wxData.errmsg || "WeChat auth failed" },
        { status: 401 }
      );
    }

    const { openid, unionid } = wxData;

    let user = await prisma.user.findUnique({
      where: { wechatOpenId: openid },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          wechatOpenId: openid,
          wechatUnionId: unionid || null,
          nickName: nickName || null,
          image: avatarUrl || null,
          role: "FOUNDER",
        },
      });
    } else if (unionid && !user.wechatUnionId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { wechatUnionId: unionid },
      });
    }

    const token = await new SignJWT({
      sub: user.id,
      openid,
      type: "wechat",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(JWT_SECRET);

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        nickName: user.nickName,
        image: user.image,
        role: user.role,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("[wechat-auth] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
