import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Telegram card payments are disabled. Use TON Wallet for Telegram meetups." },
    { status: 410 },
  );
}
