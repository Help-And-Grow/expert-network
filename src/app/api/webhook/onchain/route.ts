import { type NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { decodeEventLog, type Hex, type Log } from "viem";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Just enough EAS ABI to decode the indexed `Attested(recipient, attester,
 * uid, schemaUID)` event. We don't read the attestation payload itself
 * anymore — the credential row keyed by `attestationUID` already has
 * everything we need; the webhook only flips `onChainVerified` and
 * back-fills `txHash` if it was somehow missed at issuance time.
 */
const easAbi = [
  {
    type: "event",
    name: "Attested",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "uid", type: "bytes32", indexed: false },
      { name: "schemaUID", type: "bytes32", indexed: true },
    ],
  },
] as const;

function verifyAlchemySignature(body: string, sig: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return sig === expected;
}

/**
 * POST /api/webhook/onchain
 *
 * Alchemy (or compatible) webhook for EAS `Attested` events on Base. For
 * each Attested event matching our POMP schema, look up the matching
 * POMPCredential row by `attestationUID` and mark it `onChainVerified=true`
 * (idempotent — issuePOMPCredentials usually sets this eagerly after
 * `tx.wait()` returns, so most webhook hits are no-ops). Credentials we
 * didn't issue ourselves (e.g. external attesters using our schema) get
 * picked up here too, provided the credential row exists.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    const alchemySecret = process.env.ALCHEMY_WEBHOOK_SECRET;
    if (alchemySecret) {
      const sig = request.headers.get("x-alchemy-signature") || "";
      if (!verifyAlchemySignature(body, sig, alchemySecret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const expectedSchema = process.env.POMP_EAS_SCHEMA_UID?.trim().toLowerCase();
    if (!expectedSchema) {
      console.warn("[webhook/onchain] POMP_EAS_SCHEMA_UID not set — skipping");
      return NextResponse.json({ ok: true, processed: 0, note: "POMP_EAS_SCHEMA_UID unset" });
    }

    const payload = JSON.parse(body);
    const logs: Log[] = payload.event?.data?.block?.logs || payload.logs || [];

    let processed = 0;
    let skipped = 0;

    for (const log of logs) {
      if (!log.topics?.length) continue;

      try {
        const decoded = decodeEventLog({
          abi: easAbi,
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        });

        if (decoded.eventName !== "Attested") continue;

        const schemaUID = String(decoded.args.schemaUID).toLowerCase();
        if (schemaUID !== expectedSchema) continue;

        const uid = String(decoded.args.uid);
        const txHash = (log.transactionHash as string) || undefined;

        // Race-tolerant: if `issuePOMPCredentials` is still inserting the
        // row when the webhook arrives (Alchemy fires immediately on block
        // inclusion, our DB write follows), `update` would throw on the
        // missing key. `updateMany` returns count=0 silently instead.
        const result = await prisma.pOMPCredential.updateMany({
          where: { attestationUID: uid },
          data: {
            onChainVerified: true,
            ...(txHash ? { txHash } : {}),
          },
        });

        if (result.count > 0) {
          processed++;
        } else {
          skipped++;
          console.warn(
            `[webhook/onchain] No POMPCredential row for attestationUID=${uid} (race or external attester) — skipping`,
          );
        }
      } catch (err) {
        console.error("[webhook/onchain] Failed to process log:", err);
      }
    }

    return NextResponse.json({ ok: true, processed, skipped });
  } catch (error) {
    console.error("[webhook/onchain]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
