import { type NextRequest, NextResponse } from "next/server";

import { getExpertReputation } from "@/lib/tidb";

export const dynamic = "force-dynamic";

/**
 * GET /api/reputation/:expertId
 * Aggregated reputation from the HiClaw Postgres store (EAS / session sync).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ expertId: string }> }
) {
  try {
    const { expertId } = await params;
    if (!expertId) {
      return NextResponse.json({ error: "expertId required" }, { status: 400 });
    }

    const reputation = await getExpertReputation(expertId).catch(() => null);

    return NextResponse.json(
      reputation ?? {
        totalSBTs: 0,
        menteeCount: 0,
        topics: [],
        attestationUidList: [],
      }
    );
  } catch (error) {
    console.error("[reputation]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
