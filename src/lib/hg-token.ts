import { env } from "@/lib/env";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { prisma } from "@/lib/prisma";

const HG_TOKEN_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function redeemDiscount(uint256 amount) external",
]);

const chain = process.env.NODE_ENV === "production" ? base : baseSepolia;

function getClients() {
  const rpcUrl = env.BASE_RPC_URL;
  const pk = env.POMP_ISSUER_PRIVATE_KEY as `0x${string}`;
  if (!rpcUrl || !pk) return null;

  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);

  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
    account,
  };
}

/**
 * Credit H&G tokens to a learner after a paid booking.
 * Token amount = total SGD paid (cents / 100), 1:1 SGD to tokens.
 * Mints on-chain if contract is configured, always records in DB ledger.
 */
export async function creditTokens(
  userId: string,
  bookingId: string,
  amountCents: number,
) {
  const tokenAmount = Math.floor(amountCents / 100);
  if (tokenAmount <= 0) return null;

  const contractAddress = env.HG_TOKEN_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const clients = getClients();

  if (contractAddress && clients) {
    try {
      const txHash = await clients.walletClient.writeContract({
        address: contractAddress,
        abi: HG_TOKEN_ABI,
        functionName: "mint",
        args: [clients.account.address, BigInt(tokenAmount)],
      });
      await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (err) {
      console.error("[HG-Token] On-chain mint failed (continuing with DB ledger):", err);
    }
  }

  const result = await prisma.$transaction([
    prisma.tokenLedger.create({
      data: {
        userId,
        bookingId,
        type: "CREDIT",
        amount: tokenAmount,
        description: `Earned from booking (${amountCents} cents SGD)`,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { tokenBalance: { increment: tokenAmount } },
    }),
  ]);

  return { tokensAwarded: tokenAmount, ledgerEntry: result[0] };
}

/**
 * Redeem H&G tokens at checkout. 100 tokens = 1 SGD = 100 cents discount.
 */
export async function redeemTokens(
  userId: string,
  bookingId: string,
  tokensToRedeem: number,
) {
  if (tokensToRedeem <= 0) return { discountCents: 0, tokensDebited: 0 };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenBalance: true },
  });

  if (!user || user.tokenBalance < tokensToRedeem) {
    throw new Error(`Insufficient token balance. Have ${user?.tokenBalance ?? 0}, need ${tokensToRedeem}`);
  }

  const discountCents = Math.floor(tokensToRedeem / 100) * 100;

  await prisma.$transaction([
    prisma.tokenLedger.create({
      data: {
        userId,
        bookingId,
        type: "DEBIT",
        amount: -tokensToRedeem,
        description: `Redeemed ${tokensToRedeem} tokens for $${(discountCents / 100).toFixed(2)} SGD discount`,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { tokenBalance: { decrement: tokensToRedeem } },
    }),
  ]);

  return { discountCents, tokensDebited: tokensToRedeem };
}

/**
 * Burn tokens on-chain for a discount. Called after DB ledger debit.
 */
export async function burnForDiscount(amount: number) {
  const contractAddress = env.HG_TOKEN_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const clients = getClients();
  if (!contractAddress || !clients) return null;

  try {
    const txHash = await clients.walletClient.writeContract({
      address: contractAddress,
      abi: HG_TOKEN_ABI,
      functionName: "redeemDiscount",
      args: [BigInt(amount)],
    });
    const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, status: receipt.status };
  } catch (err) {
    console.error("[HG-Token] On-chain burn failed:", err);
    return null;
  }
}
