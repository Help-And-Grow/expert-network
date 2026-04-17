import { type NextRequest, NextResponse } from "next/server";

import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const expert = await prisma.expert.findUnique({
      where: { id },
      select: { audioIntroUrl: true },
    });

    if (!expert?.audioIntroUrl) {
      return NextResponse.json({ error: "No audio intro" }, { status: 404 });
    }

    // Support audio/mp3, audio/mpeg, audio/mp4, etc. (base64 may wrap)
    const match = expert.audioIntroUrl.match(
      /^data:(audio\/[^;]+);base64,([\s\S]+)$/
    );
    if (!match) {
      return NextResponse.json({ error: "Invalid audio data" }, { status: 500 });
    }

    const [, mimeRaw, b64Raw] = match;
    const b64 = b64Raw.replace(/\s+/g, "");
    const buffer = Buffer.from(b64, "base64");

    // Browsers expect IANA type for MP3; `audio/mp3` often fails to decode / report duration.
    const mime =
      mimeRaw.toLowerCase() === "audio/mp3" ? "audio/mpeg" : mimeRaw;

    // Full-body ETag only (no 304): empty 304 responses break <audio> in common browsers.
    const etag = `"${createHash("md5").update(buffer).digest("hex")}"`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("[experts/[id]/audio GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
