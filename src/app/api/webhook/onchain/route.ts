import { type NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import {
  createPublicClient,
  decodeEventLog,
  http,
  type Hex,
  type Log,
} from "viem";
import { base, baseSepolia } from "viem/chains";

import { POMP_EAS_SCHEMA } from "@/lib/pomp-eas-schema";
import { DEFAULT_EAS_CONTRACT_ADDRESS } from "@/lib/pomp-credential";
import { updateSessionOnChain } from "@/lib/tidb";

export const dynamic = "force-dynamic";

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
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

function verifyAlchemySignature(body: string, sig: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return sig === expected;
}

/**
 * POST /api/webhook/onchain
 * Alchemy (or compatible) webhooks: EAS `Attested` events on Base.
 * Resolves attestation payload and syncs HiClaw session rows (Postgres) by sessionHash.
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

    const rpcUrl = process.env.BASE_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "BASE_RPC_URL not configured" }, { status: 503 });
    }

    const easAddress = (process.env.EAS_CONTRACT_ADDRESS?.trim() ||
      DEFAULT_EAS_CONTRACT_ADDRESS) as Hex;
    const chain = process.env.NODE_ENV === "production" ? base : baseSepolia;
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    const payload = JSON.parse(body);
    const logs: Log[] = payload.event?.data?.block?.logs || payload.logs || [];

    const encoder = new SchemaEncoder(POMP_EAS_SCHEMA);
    let processed = 0;

    for (const log of logs) {
      if (!log.address || log.address.toLowerCase() !== easAddress.toLowerCase()) continue;
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

        const uid = decoded.args.uid as Hex;
        const att = await publicClient.readContract({
          address: easAddress,
          abi: easAbi,
          functionName: "getAttestation",
          args: [uid],
        });

        const decodedFields = encoder.decodeData(att.data);
        const sessionEntry = decodedFields.find((f) => f.name === "sessionHash");
        const sessionHash =
          typeof sessionEntry?.value === "string" ? sessionEntry.value : String(sessionEntry?.value);

        const txHash = (log.transactionHash as string) || "";

        await updateSessionOnChain(sessionHash, {
          txHash,
          easAttestationUid: uid,
        });
        processed++;
      } catch (err) {
        console.error("[webhook/onchain] Failed to process log:", err);
      }
    }

    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    console.error("[webhook/onchain]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
