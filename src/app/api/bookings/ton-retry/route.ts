import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

const TON_RATE_API = "https://tonapi.io/v2/rates?tokens=ton&currencies=sgd";

async function getSGDToTONRate(): Promise<number> {
  try {
    const res = await fetch(TON_RATE_API, { next: { revalidate: 300 } });
    const data = await res.json();
    const sgdRate = data?.rates?.TON?.prices?.SGD;
    if (sgdRate && sgdRate > 0) return sgdRate;
  } catch (e) {
    console.error("[ton-retry] Rate fetch failed:", e);
  }
  return 3.5;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await request.json();
    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
    }

    const platformWalletRaw = process.env.PLATFORM_TON_WALLET;
    if (!platformWalletRaw) {
      return NextResponse.json({ error: "TON payments not configured" }, { status: 500 });
    }
    let walletAddr = platformWalletRaw.trim().replace(/^["']|["']$/g, "");
    walletAddr = walletAddr.replace(/-/g, "+").replace(/_/g, "/");
    while (walletAddr.length % 4 !== 0) walletAddr += "=";
    console.log("[ton-retry] raw env:", JSON.stringify(platformWalletRaw), "cleaned:", walletAddr, "len:", walletAddr.length);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.founderId !== userId) {
      return NextResponse.json({ error: "Not your booking" }, { status: 403 });
    }
    if (booking.status !== "PENDING" || booking.paymentMethod !== "ton") {
      return NextResponse.json({ error: "Booking is not awaiting TON payment" }, { status: 400 });
    }

    const paymentCents = booking.depositAmountCents ?? booking.totalAmountCents ?? 0;
    const tonRate = await getSGDToTONRate();
    const paymentSGD = paymentCents / 100;
    const paymentTON = paymentSGD / tonRate;
    const paymentNanoTON = Math.ceil(paymentTON * 1e9);

    const comment = `booking:${booking.id}`;

    return NextResponse.json({
      bookingId: booking.id,
      walletAddress: walletAddr,
      amountNanoTON: paymentNanoTON.toString(),
      comment,
      paymentTON: paymentTON.toFixed(4),
      paymentSGD: paymentSGD.toFixed(2),
      depositTON: paymentTON.toFixed(4),
      depositSGD: paymentSGD.toFixed(2),
      tonRate: tonRate.toFixed(2),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bookings/ton-retry POST]", message, error);
    return NextResponse.json(
      { error: "Failed to prepare TON payment", detail: message },
      { status: 500 },
    );
  }
}
