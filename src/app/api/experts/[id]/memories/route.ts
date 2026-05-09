import { type NextRequest, NextResponse } from "next/server";

import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { resolveUserId } from "@/lib/request-auth";

/**
 * GET /api/experts/[id]/memories?q=...&limit=...
 *
 * Search an expert's cloud memory. Requires authentication — memories
 * contain internal AI-enriched profile data not intended for public access.
 */
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
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const limit = Math.min(
      20,
      Math.max(1, parseInt(searchParams.get("limit") ?? "5", 10) || 5)
    );

    if (!query) {
      return NextResponse.json(
        { error: "q query parameter is required" },
        { status: 400 }
      );
    }

    const memories = await searchExpertMemories(id, query, limit);

    return NextResponse.json({ memories, total: memories.length });
  } catch (error) {
    console.error("[experts/[id]/memories GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
