"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import type { ApiState, DraftState, Environment } from "./shared-types";
import { diffDrafts } from "./diff-engine";
import { EnvironmentPills, AddProviderDialog } from "./shared-components";
import { LlmTab } from "./llm-tab";
import { StorageTab } from "./storage-tab";
import { DatabaseTab } from "./database-tab";
import { RegionsTab } from "./regions-tab";

export default function ProvidersClient() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") || "llm";

  const [environment, setEnvironment] = useState<Environment>("production");
  const [data, setData] = useState<ApiState | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showAddLlm, setShowAddLlm] = useState(false);
  const [showAddStorage, setShowAddStorage] = useState(false);
  const [reason, setReason] = useState("");
  const [lastResponse, setLastResponse] = useState<{
    deployTriggered: boolean;
    deployError: string | null;
  } | null>(null);

  // ---- data loading ----

  const load = useCallback(
    async (env?: Environment) => {
      setLoading(true);
      setMessage(null);
      try {
        const targetEnv = env ?? environment;
        const res = await fetch(
          `/api/admin/providers?environment=${encodeURIComponent(targetEnv)}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ApiState;
        setData(body);
        if (body.environment) setEnvironment(body.environment);

        // Build draft state from API response
        const draftModels: DraftState["models"] = {};
        for (const row of body.llm) {
          draftModels[row.key] = {
            textModel: row.models.text?.default ?? "",
            imageModel: row.models.image?.default ?? "",
          };
        }
        const allScopes = [
          ...body.routing.scopes.llm,
          ...body.routing.scopes.image,
          ...body.routing.scopes.voice,
          ...body.routing.scopes.storage,
        ];
        const draftScopes: DraftState["scopes"] = {};
        for (const s of allScopes) {
          draftScopes[`${s.category}:${s.scopeKey}`] = {
            chain: [...s.chain],
            enabled: s.enabled,
            priority: s.priority,
          };
        }
        const allOverrides = [
          ...body.routing.overrides.llm,
          ...body.routing.overrides.image,
          ...body.routing.overrides.voice,
          ...body.routing.overrides.storage,
        ];
        const draftOverrides: DraftState["overrides"] = {};
        for (const o of allOverrides) {
          draftOverrides[`${o.category}:${o.routePattern}`] = {
            chainOverride: [...o.chainOverride],
            enabled: o.enabled,
            reason: o.reason,
            category: o.category,
            routePattern: o.routePattern,
          };
        }
        const draftRegions: Record<string, string> = {};
        for (const r of body.cloudRegions ?? []) {
          draftRegions[r.key] = r.dbValue ?? "";
        }
        setDraft({
          activeLlm: body.active.llm,
          llmImageChain: [...body.active.llmImageChain],
          llmVoiceChain: [...body.active.llmVoiceChain],
          activeStorage: body.active.storage,
          models: draftModels,
          scopes: draftScopes,
          overrides: draftOverrides,
          deletedOverrides: [],
          cloudRegions: draftRegions,
        });
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to load providers");
      } finally {
        setLoading(false);
      }
    },
    [environment],
  );

  useEffect(() => {
    if (status === "authenticated") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const diffEntries = useMemo(
    () => (data && draft ? diffDrafts(data, draft) : []),
    [data, draft],
  );

  // ---- apply changes ----

  const onApply = async () => {
    if (!data || !draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { environment };
      if (reason.trim()) body.reason = reason.trim();

      if (draft.activeLlm !== data.active.llm) body.activeLlm = draft.activeLlm;
      if (draft.activeStorage !== data.active.storage) body.activeStorage = draft.activeStorage;
      if (draft.llmImageChain.join(",") !== data.active.llmImageChain.join(","))
        body.llmImageChain = draft.llmImageChain;
      if (draft.llmVoiceChain.join(",") !== data.active.llmVoiceChain.join(","))
        body.llmVoiceChain = draft.llmVoiceChain;

      // Scope upserts
      const allOrigScopes = [
        ...data.routing.scopes.llm,
        ...data.routing.scopes.image,
        ...data.routing.scopes.voice,
        ...data.routing.scopes.storage,
      ];
      const scopeUpserts: Array<{
        scopeKey: string;
        displayName: string;
        description?: string | null;
        category: "llm" | "image" | "voice" | "storage";
        chain: string[];
        enabled: boolean;
        matchRules: typeof allOrigScopes[0]["matchRules"];
        priority: number;
      }> = [];
      for (const orig of allOrigScopes) {
        const dk = `${orig.category}:${orig.scopeKey}`;
        const d = draft.scopes[dk];
        if (!d) continue;
        if (
          orig.chain.join(",") !== d.chain.join(",") ||
          orig.enabled !== d.enabled ||
          orig.priority !== d.priority
        ) {
          scopeUpserts.push({
            scopeKey: orig.scopeKey,
            displayName: orig.displayName,
            description: orig.description,
            category: orig.category,
            chain: d.chain,
            enabled: d.enabled,
            matchRules: orig.matchRules,
            priority: d.priority,
          });
        }
      }
      if (scopeUpserts.length > 0) body.routingScopeUpserts = scopeUpserts;

      // Override upserts/deletes
      const overrideUpserts: Array<{
        routePattern: string;
        category: "llm" | "image" | "voice" | "storage";
        chainOverride: string[];
        enabled: boolean;
        reason?: string | null;
      }> = [];
      const allOrigOverrides = [
        ...data.routing.overrides.llm,
        ...data.routing.overrides.image,
        ...data.routing.overrides.voice,
        ...data.routing.overrides.storage,
      ];
      const origByKey = new Map(allOrigOverrides.map((o) => [`${o.category}:${o.routePattern}`, o]));
      for (const [k, d] of Object.entries(draft.overrides)) {
        const orig = origByKey.get(k);
        if (!orig) {
          if (d.chainOverride.length > 0) {
            overrideUpserts.push({
              routePattern: d.routePattern,
              category: d.category,
              chainOverride: d.chainOverride,
              enabled: d.enabled,
              reason: d.reason,
            });
          }
          continue;
        }
        if (
          orig.chainOverride.join(",") !== d.chainOverride.join(",") ||
          orig.enabled !== d.enabled ||
          (orig.reason ?? null) !== (d.reason ?? null)
        ) {
          overrideUpserts.push({
            routePattern: orig.routePattern,
            category: orig.category,
            chainOverride: d.chainOverride,
            enabled: d.enabled,
            reason: d.reason,
          });
        }
      }
      if (overrideUpserts.length > 0) body.routeOverrideUpserts = overrideUpserts;
      if (draft.deletedOverrides.length > 0) body.routeOverrideDeletes = draft.deletedOverrides;

      // Per-provider model edits + region writes
      const sysConfigUpserts: Array<{ key: string; value: string }> = [];
      const providerUpserts: Array<{
        category: "llm" | "storage";
        key: string;
        displayName: string;
        envKeys: Record<string, string>;
        models: Record<string, { envKey?: string; default?: string | null }>;
        metadata?: unknown;
        enabled?: boolean;
        sortOrder?: number;
      }> = [];

      for (const r of data.cloudRegions ?? []) {
        if (r.readonly) continue;
        const before = r.dbValue ?? "";
        const after = draft.cloudRegions?.[r.key] ?? "";
        if (before !== after) sysConfigUpserts.push({ key: r.key, value: after });
      }

      for (const row of data.llm) {
        const d = draft.models[row.key];
        if (!d) continue;
        const beforeText = row.models.text?.default ?? "";
        const beforeImage = row.models.image?.default ?? "";
        const textChanged = d.textModel !== undefined && d.textModel !== beforeText;
        const imageChanged = d.imageModel !== undefined && d.imageModel !== beforeImage;
        if (!textChanged && !imageChanged) continue;

        if (textChanged && row.models.text?.envKey) {
          sysConfigUpserts.push({ key: row.models.text.envKey, value: d.textModel ?? "" });
        }
        if (imageChanged && row.models.image?.envKey) {
          sysConfigUpserts.push({ key: row.models.image.envKey, value: d.imageModel ?? "" });
        }

        providerUpserts.push({
          category: "llm",
          key: row.key,
          displayName: row.displayName,
          envKeys: row.envKeys,
          models: {
            ...row.models,
            ...(textChanged ? { text: { envKey: row.models.text?.envKey, default: d.textModel ?? null } } : {}),
            ...(imageChanged ? { image: { envKey: row.models.image?.envKey, default: d.imageModel ?? null } } : {}),
          },
          metadata: row.metadata,
          enabled: row.enabled,
          sortOrder: row.sortOrder,
        });
      }

      if (sysConfigUpserts.length > 0) body.systemConfigUpserts = sysConfigUpserts;
      if (providerUpserts.length > 0) body.providerUpserts = providerUpserts;

      const res = await fetch("/api/admin/providers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLastResponse({
        deployTriggered: !!json.deployTriggered,
        deployError: json.deployError ?? null,
      });
      const deployBit = json.deployError
        ? ` — DB saved but Vercel sync FAILED: ${json.deployError}`
        : json.deployTriggered
          ? " — deploy triggered"
          : "";
      setMessage(`Saved ${(json.updatedKeys ?? []).length} keys${deployBit}.`);
      setShowDiff(false);
      setReason("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onRetryDeploy = async () => {
    setSaving(true);
    setMessage("Retrying deploy…");
    try {
      const res = await fetch("/api/admin/providers/retry-deploy", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLastResponse({ deployTriggered: !!json.deployTriggered, deployError: null });
      setMessage(json.deployTriggered ? "Deploy triggered." : "Deploy not triggered.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setSaving(false);
    }
  };

  // ---- loading / auth guards ----

  if (status === "loading" || (loading && !data)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (status !== "authenticated") {
    return (
      <div className="p-6 text-sm">
        <Link href="/" className="text-blue-600">Sign in required</Link>
      </div>
    );
  }
  if (!data || !draft) {
    return <div className="p-6 text-sm text-red-600">{message ?? "Failed to load."}</div>;
  }

  // ---- render ----

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />Admin</Button>
          </Link>
          <h1 className="text-xl font-semibold">Providers</h1>
          <Badge variant="outline">{data.canManage ? "Vercel sync ON" : "DB only"}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <EnvironmentPills
            value={environment}
            onChange={(env) => { setEnvironment(env); void load(env); }}
            currentVercelEnv={data.currentVercelEnv}
          />
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Reload
          </Button>
          <Button size="sm" onClick={() => setShowDiff(true)} disabled={diffEntries.length === 0 || saving}>
            <Save className="mr-1 h-4 w-4" />Apply ({diffEntries.length})
          </Button>
        </div>
      </div>

      {/* Environment warning */}
      {environment !== "production" && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <span>⚠ You are editing the <strong>{environment}</strong> environment. Changes do not affect production.</span>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className="mb-3 rounded-md border bg-slate-50 p-2 text-xs text-slate-700">
          {message}
          {lastResponse?.deployError && (
            <Button size="sm" variant="outline" className="ml-2" onClick={onRetryDeploy} disabled={saving}>
              Retry deploy
            </Button>
          )}
        </div>
      )}

      {/* Drift warning */}
      {(data.driftCount ?? 0) > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <span>⚠ <strong>{data.driftCount}</strong> config drift from Vercel.{" "}
            <Link href="/admin/providers/drift" className="font-medium underline">Review →</Link>
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="llm">LLM</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="db">Database</TabsTrigger>
          <TabsTrigger value="regions">Regions</TabsTrigger>
        </TabsList>

        <TabsContent value="llm">
          <LlmTab
            data={data} draft={draft} setDraft={setDraft}
            environment={environment} onShowAddLlm={() => setShowAddLlm(true)}
          />
        </TabsContent>

        <TabsContent value="storage">
          <StorageTab
            data={data} draft={draft} setDraft={setDraft}
            environment={environment} onShowAddStorage={() => setShowAddStorage(true)}
          />
        </TabsContent>

        <TabsContent value="db">
          <DatabaseTab data={data} />
        </TabsContent>

        <TabsContent value="regions">
          <RegionsTab
            data={data} draft={draft} setDraft={setDraft}
            environment={environment} onImported={() => load()}
          />
        </TabsContent>
      </Tabs>

      {/* Diff confirmation dialog */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm changes</DialogTitle>
            <DialogDescription>
              {diffEntries.length} change(s) will be written to SystemConfig
              <strong> ({environment})</strong> and (when configured) synced to Vercel + redeploy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
            {diffEntries.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr] gap-2 rounded border p-2">
                <div className="font-medium">{d.label}</div>
                <div className="font-mono text-xs">
                  <span className="text-red-700 line-through">{d.before}</span>{" "}
                  → <span className="text-emerald-700">{d.after}</span>
                </div>
              </div>
            ))}
            {diffEntries.length === 0 && (
              <p className="text-xs italic text-slate-500">No changes.</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">
              Why are you making this change? <span className="font-normal text-slate-500">(optional, recorded in audit log)</span>
            </label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. rotating leaked OpenAI API key" className="text-sm" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDiff(false)} disabled={saving}>Cancel</Button>
            <Button onClick={onApply} disabled={saving || diffEntries.length === 0}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />}
              Confirm &amp; Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add provider dialogs */}
      <AddProviderDialog open={showAddLlm} category="llm" onClose={() => setShowAddLlm(false)} onSaved={() => load()} />
      <AddProviderDialog open={showAddStorage} category="storage" onClose={() => setShowAddStorage(false)} onSaved={() => load()} />
    </div>
  );
}
