import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const expert = await prisma.expert.findUnique({
      where: { id },
      select: { documentName: true, documentData: true },
    });

    if (!expert?.documentData || !expert.documentName) {
      return NextResponse.json(
        { error: "No document available" },
        { status: 404 }
      );
    }

    const match = expert.documentData.match(
      /^data:([^;]+);base64,(.+)$/
    );
    if (!match) {
      return NextResponse.json(
        { error: "Invalid document data" },
        { status: 500 }
      );
    }

    const [, contentType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    const safeFilename = expert.documentName.replace(/[^ -~]/g, '_').replace(/"/g, "'");
    const encodedFilename = encodeURIComponent(expert.documentName);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("[expert document GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
