import { env } from "@/lib/env";
import {
  EAS,
  NO_EXPIRATION,
  SchemaEncoder,
  getUIDsFromAttestReceipt,
} from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";
import { keccak256, encodePacked } from "viem";

import { prisma } from "@/lib/prisma";

import { POMP_EAS_SCHEMA } from "./pomp-eas-schema";

/** Canonical EAS contract on Base mainnet and Base Sepolia (OP stack predeploy). */
export const DEFAULT_EAS_CONTRACT_ADDRESS =
  "0x4200000000000000000000000000000000000021" as const;

function getChainId(): number {
  return process.env.NODE_ENV === "production" ? 8453 : 84532;
}

function getEasAddress(): `0x${string}` {
  const fromEnv = env.EAS_CONTRACT_ADDRESS?.trim();
  if (fromEnv?.startsWith("0x") && fromEnv.length === 42) {
    return fromEnv as `0x${string}`;
  }
  return DEFAULT_EAS_CONTRACT_ADDRESS;
}

function normalizePrivateKey(pk: string): `0x${string}` {
  const t = pk.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

export async function issuePOMPCredentials(bookingId: string) {
  const schemaUID = env.POMP_EAS_SCHEMA_UID?.trim() as `0x${string}` | undefined;
  const rpcUrl = env.BASE_RPC_URL;
  const pkRaw = env.POMP_ISSUER_PRIVATE_KEY;

  if (!schemaUID || !rpcUrl || !pkRaw) {
    console.warn(
      "[POMP] Skipping EAS attest — set POMP_EAS_SCHEMA_UID, BASE_RPC_URL, POMP_ISSUER_PRIVATE_KEY"
    );
    return null;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { expert: { include: { user: true } }, founder: true },
  });

  if (!booking) return null;

  const provider = new ethers.JsonRpcProvider(rpcUrl, getChainId());
  const signer = new ethers.Wallet(normalizePrivateKey(pkRaw), provider);
  const eas = new EAS(getEasAddress()).connect(signer);

  const hours = (booking.endTime.getTime() - booking.startTime.getTime()) / 3600000;
  const expertName = booking.expert.user.nickName || booking.expert.user.name || "Expert";
  const learnerName = booking.founder.nickName || booking.founder.name || "Learner";
  const topic = booking.sessionType;

  const sessionHash = keccak256(
    encodePacked(
      ["string", "string", "string", "string"],
      [booking.expertId, booking.founderId, booking.startTime.toISOString(), booking.endTime.toISOString()]
    )
  );

  const encoder = new SchemaEncoder(POMP_EAS_SCHEMA);
  const results: { role: string; uid: string; txHash: string }[] = [];

  for (const role of ["EXPERT", "LEARNER"] as const) {
    const recipientName = role === "EXPERT" ? expertName : learnerName;
    const recipientRole = role === "EXPERT" ? "EXPERT" : "LEARNER";

    const encodedData = encoder.encodeData([
      { name: "sessionHash", type: "bytes32", value: sessionHash },
      { name: "expertId", type: "string", value: booking.expertId },
      { name: "menteeId", type: "string", value: booking.founderId },
      { name: "topic", type: "string", value: topic },
      { name: "recipientRole", type: "string", value: recipientRole },
    ]);

    try {
      const txReq = await eas.attest({
        schema: schemaUID,
        data: {
          recipient: ethers.ZeroAddress,
          expirationTime: NO_EXPIRATION,
          revocable: true,
          refUID: ethers.ZeroHash,
          data: encodedData,
          value: BigInt(0),
        },
      });

      const pending = await signer.sendTransaction(txReq.data);
      const receipt = await pending.wait();
      if (!receipt) throw new Error("Missing receipt");

      const uid = String(getUIDsFromAttestReceipt(receipt)[0]);
      const txHash = receipt.hash;

      await prisma.pOMPCredential.create({
        data: {
          expertId: booking.expertId,
          bookingId: booking.id,
          recipientRole: role,
          attestationUID: uid,
          recipient: recipientName,
          hours,
        },
      });

      results.push({ role, uid, txHash });
    } catch (error) {
      console.error(`[POMP] ${role} EAS attest failed:`, error);
    }
  }

  return results;
}
