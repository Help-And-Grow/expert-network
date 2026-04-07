import { NextResponse } from "next/server";

import { getVoiceChatClientConfig } from "@/lib/voice-chat-config";

export async function GET() {
  return NextResponse.json(getVoiceChatClientConfig());
}
