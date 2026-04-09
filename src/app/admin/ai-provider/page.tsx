"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Bot, Loader2, RefreshCw, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ProviderName = "qwen" | "gemini" | "openai" | "zai" | "dedalus";

type ProviderHealth = Record<
  ProviderName,
  {
    configured: boolean;
    requiredAny: string[][];
    optional: string[];
  }
>;

type StatusResponse = {
  canManage: boolean;
  currentProvider: ProviderName;
  managedProject?: string;
  managedTeamId?: string;
  deployHookConfigured?: boolean;
  providerHealth?: ProviderHealth;
  error?: string;
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  qwen: "Qwen / DashScope",
  gemini: "Gemini",
  openai: "OpenAI",
  zai: "Z.ai",
  dedalus: "Dedalus",
};

export default function AdminAIProviderPage() {
  const { status } = useSession();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>("qwen");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-provider", { credentials: "include" });
      const body = (await res.json()) as StatusResponse;
      setData(body);
      if (body.currentProvider) setSelectedProvider(body.currentProvider);
    } catch (error) {
      setData({
        canManage: false,
        currentProvider: "qwen",
        error: error instanceof Error ? error.message : "Failed to load provider status",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status]);

  async function applyProvider() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: selectedProvider, triggerDeploy: true }),
      });
      const body = (await res.json()) as { error?: string; deployTriggered?: boolean };
      if (!res.ok) {
        throw new Error(body.error || "Failed to update provider");
      }
      setMessage(
        body.deployTriggered
          ? `Provider updated to ${PROVIDER_LABELS[selectedProvider]}. Redeploy triggered.`
          : `Provider updated to ${PROVIDER_LABELS[selectedProvider]}. Deploy hook not configured, so trigger a redeploy manually.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update provider");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="mx-auto max-w-lg p-8">
        <p className="text-slate-600">Sign in to access this page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Admin
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Provider Control
          </CardTitle>
          <CardDescription>
            Switch the managed Vercel project between Gemini, Z.ai, Qwen, OpenAI, and Dedalus.
            This updates the `AI_PROVIDER` environment variable and can trigger a redeploy immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {data.error}
            </div>
          )}

          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Current deployment</p>
              <p className="mt-1 font-medium">{PROVIDER_LABELS[data?.currentProvider ?? "qwen"]}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Managed project</p>
              <p className="mt-1 font-medium">{data?.managedProject ?? "Not configured"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Managed team</p>
              <p className="mt-1 font-medium">{data?.managedTeamId ?? "Not configured"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Deploy hook</p>
              <p className="mt-1 font-medium">
                {data?.deployHookConfigured ? "Configured" : "Manual redeploy required"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium text-slate-800">
              Provider
              <select
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedProvider}
                onChange={(event) =>
                  setSelectedProvider(event.target.value as ProviderName)
                }
                disabled={!data?.canManage || saving}
              >
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void load()} disabled={loading || saving}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button onClick={applyProvider} disabled={!data?.canManage || saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                Apply
              </Button>
            </div>
          </div>

          {message && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.providerHealth && (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            Object.entries(data.providerHealth) as Array<
              [ProviderName, ProviderHealth[ProviderName]]
            >
          ).map(([provider, health]) => (
            <Card key={provider}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{PROVIDER_LABELS[provider]}</CardTitle>
                  <Badge variant="outline" className={health.configured ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}>
                    {health.configured ? "Ready" : "Missing env"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">Required</p>
                  {health.requiredAny.map((group, index) => (
                    <p key={index} className="mt-1 text-slate-600">
                      {group.join(" + ")}
                    </p>
                  ))}
                </div>
                {health.optional.length > 0 && (
                  <div>
                    <p className="font-medium text-slate-800">Optional</p>
                    <p className="mt-1 text-slate-600">{health.optional.join(", ")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
