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
    end = size - 1;
  }
  return { start, end };
}

async function resolveAudioBytes(
  audioIntroUrl: string,
): Promise<{ mime: string; buffer: Buffer }> {
  const trimmed = audioIntroUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const res = await fetch(trimmed, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const mime = contentType?.toLowerCase() === "audio/mp3" ? "audio/mpeg" : contentType || "audio/mpeg";
    return { mime, buffer };
  }

  const dataUrlMatch = trimmed.match(/^data:([^,]+),([\s\S]+)$/);
  if (!dataUrlMatch) {
    throw new Error("Unsupported audio source");
  }

  const meta = dataUrlMatch[1] ?? "";
  const payload = dataUrlMatch[2] ?? "";
  const [mimeRaw = "audio/mpeg", ...params] = meta.split(";");
  const mime = mimeRaw.toLowerCase() === "audio/mp3" ? "audio/mpeg" : mimeRaw;
  const isBase64 = params.some((p) => p.trim().toLowerCase() === "base64");
  const buffer = isBase64
    ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return { mime, buffer };
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

    const { mime, buffer } = await resolveAudioBytes(expert.audioIntroUrl);
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty audio intro" }, { status: 404 });
    }

    // Full-body ETag only (no 304): empty 304 responses break <audio> in common browsers.
    const etag = `"${createHash("md5").update(buffer).digest("hex")}"`;
    const size = buffer.length;

    const rangeHeader = request.headers.get("range");
    const parsed = parseByteRange(rangeHeader, size);

    if (parsed) {
      const { start, end } = expandInitialRangeForDecoders(parsed, size);
      const chunk = new Uint8Array(buffer.subarray(start, end + 1));
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

    return new NextResponse(new Uint8Array(buffer), {
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
