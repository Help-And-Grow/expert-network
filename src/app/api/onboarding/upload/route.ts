import { type NextRequest, NextResponse } from "next/server";

import { extractTextFromPdf } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum 4MB." },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    try {
      text = await extractTextFromPdf(buffer);
    } catch (e) {
      console.warn("[upload] PDF text extraction failed, saving file without text:", e instanceof Error ? e.message : e);
    }

    const trimmedText = text.trim().slice(0, 5000);
    const base64File = buffer.toString("base64");
    const dataUrl = `data:application/pdf;base64,${base64File}`;

    let expert = await prisma.expert.findUnique({
      where: { userId },
    });

    const documentFields = {
      documentName: file.name,
      documentData: dataUrl,
    };

    if (!expert) {
      expert = await prisma.expert.create({
        data: {
          userId,
          ...documentFields,
          ...(trimmedText ? { avatarScript: trimmedText } : {}),
        },
      });
    } else {
      const updateData: Record<string, unknown> = { ...documentFields };
      if (trimmedText && !expert.bio) {
        updateData.avatarScript = trimmedText;
      }
      expert = await prisma.expert.update({
        where: { id: expert.id },
        data: updateData,
      });
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      textLength: trimmedText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[onboarding/upload POST]", message, error);
    return NextResponse.json(
      { error: `Failed to process file: ${message}` },
      { status: 500 }
    );
  }
}
