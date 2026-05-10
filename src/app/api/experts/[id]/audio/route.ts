import { type NextRequest, NextResponse } from "next/server";

import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";

/**
 * Parse first `bytes=...` range (Safari / mobile `<audio>` often probe with Range).
 */
function parseByteRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.toLowerCase().startsWith("bytes=")) {
    return null;
  }
  const first = rangeHeader.slice(6).split(",")[0]?.trim();
  if (!first) return null;

  const dash = first.indexOf("-");
  if (dash < 0) return null;
  const left = first.slice(0, dash);
  const right = first.slice(dash + 1);

  let start: number;
  let end: number;

  if (left === "" && right !== "") {
    const suffix = parseInt(right, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (left !== "" && right === "") {
    start = parseInt(left, 10);
    if (!Number.isFinite(start)) return null;
    end = size - 1;
  } else if (left !== "" && right !== "") {
    start = parseInt(left, 10);
    end = parseInt(right, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  } else {
    return null;
  }

  if (start >= size) return null;
  end = Math.min(end, size - 1);
  if (start > end) return null;
  return { start, end };
}

/**
 * Browsers often probe with `Range: bytes=0-1`. A 206 with only 1–2 bytes of MP3 is not decodable
 * and triggers MEDIA_ERR_DECODE on `<audio>`. Expand tiny reads from offset 0 to a minimum span
 * (capped by file size) so the first response includes a valid header + initial frames.
 */
function expandInitialRangeForDecoders(
  parsed: { start: number; end: number },
  size: number,
): { start: number; end: number } {
  if (size <= 0) return parsed;
  const { start } = parsed;
  let { end } = parsed;
  const minSpan = Math.min(65536, size);
  const span = end - start + 1;
  if (start === 0 && span < minSpan && end < size - 1) {
    end = Math.min(size - 1, start + minSpan - 1);
  }
  return { start, end };
}

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

    const audioUrl = expert.audioIntroUrl;
    if (audioUrl.startsWith("http")) {
      return NextResponse.redirect(audioUrl);
    }

    // Support audio/mp3, audio/mpeg, audio/mp4, etc. (base64 may wrap)
    const match = audioUrl.match(
      /^data:(audio\/[^;]+);base64,([\s\S]+)$/
    );
    if (!match) {
      return NextResponse.json({ error: "Invalid audio data" }, { status: 500 });
    }

    const [, mimeRaw, b64Raw] = match;
    const b64 = b64Raw.replace(/\s+/g, "");
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty audio intro" }, { status: 404 });
    }

    // Browsers expect IANA type for MP3; `audio/mp3` often fails to decode / report duration.
    const mime =
      mimeRaw.toLowerCase() === "audio/mp3" ? "audio/mpeg" : mimeRaw;

    // Full-body ETag only (no 304): empty 304 responses break <audio> in common browsers.
    const etag = `"${createHash("md5").update(buffer).digest("hex")}"`;
    const size = buffer.length;

    // WeChat Mini Program's Taro.downloadFile() does not reliably handle HTTP 206
    // Partial Content. The client sends ?full=1 to request a complete 200 response
    // so it can download the entire file as a local temp file for InnerAudioContext.
    const forceFull = request.nextUrl.searchParams.get("full") === "1";

    const rangeHeader = !forceFull ? request.headers.get("range") : null;
    const parsed = parseByteRange(rangeHeader, size);

    if (parsed) {
      const { start, end } = expandInitialRangeForDecoders(parsed, size);
      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          ETag: etag,
        },
      });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
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
