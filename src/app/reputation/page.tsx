"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { Award, Coins, TrendingUp, Users, ExternalLink } from "lucide-react";

const HG_TOKEN_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
]);

interface ReputationData {
  totalSBTs: number;
  menteeCount: number;
  topics: string[];
  attestationUidList?: string[];
}

interface TokenData {
  balance: number;
  redeemableValueSGD: number;
  ledger: { id: string; type: string; amount: number; description: string; createdAt: string }[];
}

export default function ReputationPage() {
  const { data: session } = useSession();
  const { address, isConnected } = useAccount();
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [activeTab, setActiveTab] = useState<"expert" | "mentee">("expert");

  const hgAddress = process.env.NEXT_PUBLIC_HG_TOKEN_ADDRESS as `0x${string}` | undefined;
  const easSchemaUid = process.env.NEXT_PUBLIC_POMP_EAS_SCHEMA_UID;

  const { data: onChainTokenBalance } = useReadContract({
    address: hgAddress,
    abi: HG_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!hgAddress && !!address },
  });

  const expertId = useMemo(() => {
    return (session?.user as { expertId?: string } | undefined)?.expertId;
  }, [session]);

  useEffect(() => {
    if (!expertId) return;
    fetch(`/api/reputation/${expertId}`)
      .then((r) => r.json())
      .then(setReputation)
      .catch(console.error);
  }, [expertId]);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/user/tokens")
      .then((r) => r.json())
      .then(setTokenData)
      .catch(console.error);
  }, [session?.user]);

  const topicCounts = useMemo(() => {
    if (!reputation?.topics) return [];
    const counts: Record<string, number> = {};
    for (const t of reputation.topics) {
      const key = t.length > 40 ? t.slice(0, 40) + "..." : t;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [reputation]);

  const maxTopicCount = useMemo(() => Math.max(1, ...topicCounts.map(([, c]) => c)), [topicCounts]);

  const verifiedOnChainCount = useMemo(() => {
    return reputation?.attestationUidList?.length ?? 0;
  }, [reputation]);

  const easscanBase =
    process.env.NODE_ENV === "production"
      ? "https://base.easscan.org"
      : "https://base-sepolia.easscan.org";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-bold">Reputation Dashboard</h1>
        <p className="mb-8 text-slate-400">
          On-chain meet attestations (EAS on Base) and your Help &amp; Grow token balance—proof of
          helping and learning on the network.
        </p>

        <div className="mb-8 flex gap-2">
          <button
            onClick={() => setActiveTab("expert")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === "expert"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Expert View
          </button>
          <button
            onClick={() => setActiveTab("mentee")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === "mentee"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Mentee View
          </button>
        </div>

        {activeTab === "expert" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                icon={<Award className="h-5 w-5 text-amber-400" />}
                label="Verified sessions (HiClaw DB)"
                value={reputation?.totalSBTs ?? 0}
              />
              <StatCard
                icon={<Users className="h-5 w-5 text-blue-400" />}
                label="Unique mentees"
                value={reputation?.menteeCount ?? 0}
              />
              <StatCard
                icon={<TrendingUp className="h-5 w-5 text-green-400" />}
                label="On-chain sync rows"
                value={verifiedOnChainCount}
              />
            </div>

            {topicCounts.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold">Topic breakdown</h2>
                <div className="space-y-3">
                  {topicCounts.map(([topic, count]) => (
                    <div key={topic}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-300">{topic}</span>
                        <span className="text-slate-500">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all"
                          style={{ width: `${(count / maxTopicCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reputation?.attestationUidList && reputation.attestationUidList.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="mb-2 text-lg font-semibold">Recent attestation UIDs</h2>
                <ul className="space-y-1 font-mono text-xs text-slate-400">
                  {reputation.attestationUidList.slice(0, 8).map((uid) => (
                    <li key={uid} className="truncate">
                      <a
                        href={`${easscanBase}/attestation/view/${uid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline"
                      >
                        {uid}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isConnected && address && easSchemaUid && (
              <a
                href={`${easscanBase}/schema/view/${easSchemaUid}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                POMP schema on EASScan
              </a>
            )}

            {isConnected && (
              <p className="text-sm text-slate-500">
                Connected wallet: {address?.slice(0, 6)}...{address?.slice(-4)}
              </p>
            )}
          </div>
        )}

        {activeTab === "mentee" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                icon={<Coins className="h-5 w-5 text-amber-400" />}
                label="H&G token balance"
                value={
                  tokenData?.balance ??
                  (onChainTokenBalance !== undefined ? Number(onChainTokenBalance) : 0)
                }
              />
              <StatCard
                icon={<TrendingUp className="h-5 w-5 text-green-400" />}
                label="Redeemable (SGD)"
                value={`$${tokenData?.redeemableValueSGD ?? 0}`}
              />
              <StatCard
                icon={<Award className="h-5 w-5 text-blue-400" />}
                label="On-chain balance"
                value={onChainTokenBalance !== undefined ? Number(onChainTokenBalance) : "—"}
              />
            </div>

            {tokenData?.ledger && tokenData.ledger.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold">Transaction history</h2>
                <div className="space-y-2">
                  {tokenData.ledger.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-3"
                    >
                      <div>
                        <span
                          className={`text-sm font-medium ${
                            entry.type === "CREDIT" ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {entry.type === "CREDIT" ? "+" : ""}
                          {entry.amount} HG
                        </span>
                        <p className="text-xs text-slate-500">{entry.description}</p>
                      </div>
                      <span className="text-xs text-slate-600">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isConnected && (
              <p className="text-sm text-slate-500">
                Connected wallet: {address?.slice(0, 6)}...{address?.slice(-4)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
