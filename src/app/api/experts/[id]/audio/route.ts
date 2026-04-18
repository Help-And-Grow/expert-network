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

function sniffAudioMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return "audio/wav";
  }
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return "audio/ogg";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "audio/webm";
  }
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return "audio/mp4";
  }
  return null;
}

/**
 * Parse stored intro blob — tolerant of `Data:`, `BASE64`, odd MIME labels, and legacy rows
 * where the declared type is not audio/* but the payload is decodable audio.
 */
function parseStoredAudioIntro(
  raw: string | null | undefined,
): { mime: string; buffer: Buffer } | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (!lower.startsWith("data:")) return null;
  const marker = ";base64,";
  const bi = lower.indexOf(marker);
  if (bi < 0) return null;

  const header = s.slice(0, bi);
  const mimeDeclared = header.slice(5).split(";")[0]?.trim() ?? "";
  const b64 = s.slice(bi + marker.length).replace(/\s+/g, "");
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) return null;

  let mime = mimeDeclared;
  if (!/^audio\//i.test(mime)) {
    const sniffed = sniffAudioMimeFromBuffer(buffer);
    if (!sniffed) return null;
    mime = sniffed;
  }

  if (mime.toLowerCase() === "audio/mp3") mime = "audio/mpeg";
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

    const parsedIntro = parseStoredAudioIntro(expert.audioIntroUrl);
    if (!parsedIntro) {
      return NextResponse.json({ error: "Invalid audio data" }, { status: 500 });
    }

    const { mime, buffer } = parsedIntro;
    const body = new Uint8Array(buffer);

    // Full-body ETag only (no 304): empty 304 responses break <audio> in common browsers.
    const etag = `"${createHash("md5").update(buffer).digest("hex")}"`;
    const size = body.length;

    /** Fetch+blob clients (Telegram WebView, AudioPlayer) — always 200 full body; avoids 206+blob edge cases. */
    const forceFullBody =
      request.nextUrl.searchParams.get("full") === "1" ||
      request.nextUrl.searchParams.get("full") === "true";

    if (forceFullBody) {
      return new NextResponse(body, {
        headers: {
          "Content-Type": mime,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          ETag: etag,
        },
      });
    }

    const rangeHeader = request.headers.get("range");
    const parsed = parseByteRange(rangeHeader, size);

    if (parsed) {
      const { start, end } = expandInitialRangeForDecoders(parsed, size);
      const chunk = body.subarray(start, end + 1);
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

    return new NextResponse(body, {
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
