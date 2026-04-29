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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProviderName =
  | "openai"
  | "zai"
  | "qwen"
  | "gemini"
  | "hunyuan"
  | "dedalus"
  | "byteplus"
  | "volcengine";

type ProviderHealth = Record<
  ProviderName,
  {
    configured: boolean;
    requiredAny: string[][];
    optional: string[];
    supportsImage: boolean;
  }
>;

type ProviderDescriptor = {
  name: ProviderName;
  label: string;
  description: string;
  requiredAny: string[][];
  optional: string[];
  supportsImage: boolean;
  textModelEnvKey: string | null;
  imageModelEnvKey: string | null;
  defaultTextModel: string | null;
  defaultImageModel: string | null;
  textModel: string | null;
  imageModel: string | null;
};

type VoiceProviderName = "qwen-tts" | "gemini-tts";

type StatusResponse = {
  canManage: boolean;
  currentProvider: ProviderName;
  managedProject?: string;
  managedTeamId?: string;
  deployHookConfigured?: boolean;
  providerHealth?: ProviderHealth;
  providers: ProviderDescriptor[];
  imageProviderChain: ProviderName[];
  voiceProviderChain: VoiceProviderName[];
  imageProviderChainDefault: ProviderName[];
  voiceProviderChainDefault: VoiceProviderName[];
  voiceProviderOptions: VoiceProviderName[];
  /** @deprecated mirrored from imageProviderChain for older clients */
  imageFallbackOrder: ProviderName[];
  error?: string;
};

type ModelDraft = {
  textModel: string;
  imageModel: string;
};

export default function AdminAIProviderPage() {
  const { status } = useSession();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>("qwen");
  const [imageChainDraft, setImageChainDraft] = useState<string>("");
  const [voiceChainDraft, setVoiceChainDraft] = useState<string>("");
  const [providerModels, setProviderModels] = useState<
    Record<ProviderName, ModelDraft>
  >({
    openai: { textModel: "", imageModel: "" },
    zai: { textModel: "", imageModel: "" },
    qwen: { textModel: "", imageModel: "" },
    gemini: { textModel: "", imageModel: "" },
    hunyuan: { textModel: "", imageModel: "" },
    dedalus: { textModel: "", imageModel: "" },
    byteplus: { textModel: "", imageModel: "" },
    volcengine: { textModel: "", imageModel: "" },
  });

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-provider", { credentials: "include" });
      const body = (await res.json()) as StatusResponse;
      setData(body);
      setSelectedProvider(body.currentProvider ?? "qwen");
      setImageChainDraft((body.imageProviderChain ?? []).join(","));
      setVoiceChainDraft((body.voiceProviderChain ?? []).join(","));
      const providers = body.providers ?? [];
      setProviderModels(
        providers.reduce(
          (acc, provider) => {
            acc[provider.name] = {
              textModel: provider.textModel ?? provider.defaultTextModel ?? "",
              imageModel: provider.imageModel ?? provider.defaultImageModel ?? "",
            };
            return acc;
          },
          {
            openai: { textModel: "", imageModel: "" },
            zai: { textModel: "", imageModel: "" },
            qwen: { textModel: "", imageModel: "" },
            gemini: { textModel: "", imageModel: "" },
            hunyuan: { textModel: "", imageModel: "" },
            dedalus: { textModel: "", imageModel: "" },
            byteplus: { textModel: "", imageModel: "" },
            volcengine: { textModel: "", imageModel: "" },
          } satisfies Record<ProviderName, ModelDraft>,
        ),
      );
    } catch (error) {
      setData({
        canManage: false,
        currentProvider: "qwen",
        providers: [],
        imageProviderChain: ["qwen", "gemini"],
        voiceProviderChain: ["qwen-tts", "gemini-tts"],
        imageProviderChainDefault: ["qwen", "gemini"],
        voiceProviderChainDefault: ["qwen-tts", "gemini-tts"],
        voiceProviderOptions: ["qwen-tts", "gemini-tts"],
        imageFallbackOrder: ["qwen", "gemini"],
        error: error instanceof Error ? error.message : "Failed to load provider status",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status]);

  function updateModel(
    provider: ProviderName,
    field: keyof ModelDraft,
    value: string,
  ) {
    setProviderModels((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        [field]: value,
      },
    }));
  }

  async function applyProvider() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: selectedProvider,
          providerModels: {
            [selectedProvider]: providerModels[selectedProvider],
          },
          imageProviderChain: imageChainDraft,
          voiceProviderChain: voiceChainDraft,
          triggerDeploy: true,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        deployTriggered?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || "Failed to update provider");
      }
      setMessage(
        body.deployTriggered
          ? "AI provider settings updated. Redeploy triggered."
          : "AI provider settings updated. Deploy hook not configured, so redeploy manually.",
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
    <div className="mx-auto max-w-6xl space-y-6 p-6">
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
            Switch the active provider and pin per-provider model IDs without
            editing Vercel environment scripts. Image and voice provider chains
            are configurable below — defaults match the current Tencent/Gemini
            architecture.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {data.error}
            </div>
          )}

          <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Current deployment</p>
              <p className="mt-1 font-medium">
                {data?.providers.find((provider) => provider.name === data.currentProvider)
                  ?.label ?? data?.currentProvider}
              </p>
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

          <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Active provider</label>
              <Select
                value={selectedProvider}
                onValueChange={(value) => setSelectedProvider(value as ProviderName)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose provider" />
                </SelectTrigger>
                <SelectContent>
                  {data?.providers.map((provider) => (
                    <SelectItem key={provider.name} value={provider.name}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Apply writes the selected provider plus that provider&apos;s model
                pins. Leaving the defaults in place still writes the
                recommended model IDs so the deployment stays reproducible.
              </p>
            </div>
            <div className="flex gap-2 self-end">
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
                Apply & Redeploy
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              <label
                htmlFor="image-chain"
                className="block font-medium text-slate-800"
              >
                Image provider chain
              </label>
              <p className="mt-0.5 text-xs text-slate-600">
                Comma-separated, in order. Default:{" "}
                {(data?.imageProviderChainDefault ?? []).join(",") || "qwen,gemini"}
              </p>
              <input
                id="image-chain"
                type="text"
                value={imageChainDraft}
                onChange={(e) => setImageChainDraft(e.target.value)}
                placeholder="qwen,gemini"
                className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500">
                Active: {(data?.imageProviderChain ?? []).join(" → ") || "(default)"}
              </p>
            </div>
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              <label
                htmlFor="voice-chain"
                className="block font-medium text-slate-800"
              >
                Voice (TTS) provider chain
              </label>
              <p className="mt-0.5 text-xs text-slate-600">
                Allowed: {(data?.voiceProviderOptions ?? []).join(", ") || "qwen-tts, gemini-tts"}.
                Default: {(data?.voiceProviderChainDefault ?? []).join(",") || "qwen-tts,gemini-tts"}
              </p>
              <input
                id="voice-chain"
                type="text"
                value={voiceChainDraft}
                onChange={(e) => setVoiceChainDraft(e.target.value)}
                placeholder="qwen-tts,gemini-tts"
                className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500">
                Active: {(data?.voiceProviderChain ?? []).join(" → ") || "(default)"}
              </p>
            </div>
          </div>

          {message && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {data?.providers.map((provider) => {
          const health = data.providerHealth?.[provider.name];
          const active = provider.name === selectedProvider;
          return (
            <Card
              key={provider.name}
              className={active ? "border-slate-900 shadow-sm" : undefined}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{provider.label}</CardTitle>
                    <CardDescription className="mt-1">
                      {provider.description}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {active && <Badge variant="secondary">Active</Badge>}
                    <Badge
                      variant="outline"
                      className={
                        health?.configured
                          ? "border-emerald-200 text-emerald-700"
                          : "border-amber-200 text-amber-700"
                      }
                    >
                      {health?.configured ? "Ready" : "Missing env"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">
                      Text Model
                    </label>
                    <Input
                      value={providerModels[provider.name]?.textModel ?? ""}
                      onChange={(event) =>
                        updateModel(provider.name, "textModel", event.target.value)
                      }
                      disabled={!provider.textModelEnvKey}
                      placeholder={provider.defaultTextModel ?? "Not used"}
                    />
                    <p className="text-xs text-slate-500">
                      {provider.textModelEnvKey
                        ? `${provider.textModelEnvKey} · recommended ${provider.defaultTextModel ?? "n/a"}`
                        : "This provider does not use a dedicated text model env key."}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">
                      Image Model
                    </label>
                    <Input
                      value={providerModels[provider.name]?.imageModel ?? ""}
                      onChange={(event) =>
                        updateModel(provider.name, "imageModel", event.target.value)
                      }
                      disabled={!provider.imageModelEnvKey}
                      placeholder={provider.defaultImageModel ?? "Not supported"}
                    />
                    <p className="text-xs text-slate-500">
                      {provider.imageModelEnvKey
                        ? `${provider.imageModelEnvKey} · recommended ${provider.defaultImageModel ?? "n/a"}`
                        : provider.supportsImage
                          ? "Image generation is supported, but this provider is managed elsewhere."
                          : "Image generation is not supported for this provider."}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="font-medium text-slate-800">Required</p>
                    {provider.requiredAny.map((group, index) => (
                      <p key={index} className="mt-1 text-slate-600">
                        {group.join(" + ")}
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">Optional</p>
                    <p className="mt-1 text-slate-600">
                      {provider.optional.length > 0
                        ? provider.optional.join(", ")
                        : "None"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
