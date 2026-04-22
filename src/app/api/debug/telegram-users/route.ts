import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDebugAccess(request);
  if (isDebugAccessDenied(access)) return access;

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { telegramUsername: { not: null } },
        { telegramId: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
      createdAt: true,
      expert: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ count: users.length, users });
}
