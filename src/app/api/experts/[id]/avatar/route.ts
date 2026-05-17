import { NextResponse } from "next/server";

import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const expert = await prisma.expert.findUnique({
      where: { id },
      select: { avatarVideoUrl: true, updatedAt: true },
    });

    if (!expert?.avatarVideoUrl) {
      return NextResponse.json(
        { error: "No avatar available" },
        { status: 404 }
      );
    }

    const match = expert.avatarVideoUrl.match(
      /^data:([^;]+);base64,(.+)$/
    );
    if (!match) {
      return NextResponse.json(
        { error: "Invalid avatar data" },
        { status: 500 }
      );
    }

    const [, contentType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    // ETag must reflect the actual stored bytes, otherwise two different
    // images with similar PNG headers collide (the previous version hashed
    // only the first 200 base64 chars — every regenerated image with the
    // same dimensions returned the same ETag, so browsers + Next.js Image
    // optimizer served the stale variant on refresh). Mix in updatedAt as a
    // cheap salt so even hash-identical bytes invalidate when the row was
    // re-saved, and hash the full base64 to be content-addressed.
    const etag = `"${createHash("md5")
      .update(`${expert.updatedAt.toISOString()}:${base64Data}`)
      .digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304 });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, no-cache, must-revalidate",
        "Content-Length": String(buffer.length),
        "ETag": etag,
        "Last-Modified": expert.updatedAt.toUTCString(),
      },
    });
  } catch (error) {
    console.error("[expert avatar GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
