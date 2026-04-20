import { NextResponse } from "next/server";

import { getAppOrigin } from "@/lib/app-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = getAppOrigin(request);

  return NextResponse.json(
    {
      url: origin,
      name: "Help & Grow",
      iconUrl: `${origin}/favicon.ico`,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
