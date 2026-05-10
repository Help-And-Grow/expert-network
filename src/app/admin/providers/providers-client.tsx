"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Database,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  X,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  History,
} from "lucide-react";

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

type ProviderRow = {
  id: string;
  category: string;
  key: string;
  displayName: string;
  enabled: boolean;
  envKeys: Record<string, string>;
  models: Record<
    string,
    { envKey?: string; default?: string | null } | undefined
  >;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
};

type ProviderHealthEntry = {
  configured: boolean;
  requiredAny: string[][];
  optional: string[];
  supportsImage: boolean;
};

type RoutingMatchRules = {
  isWeChat?: boolean;
  region?: "intl" | "cn";
  userAgent?: string;
  header?: Record<string, string>;
};

type RoutingScopeRow = {
  id: string;
  scopeKey: string;
  displayName: string;
  description: string | null;
  category: "llm" | "image" | "voice" | "storage";
  chain: string[];
  enabled: boolean;
  matchRules: RoutingMatchRules;
  priority: number;
  environment: string;
};

type RouteOverrideRow = {
  id: string;
  routePattern: string;
  category: "llm" | "image" | "voice" | "storage";
  chainOverride: string[];
  enabled: boolean;
  reason: string | null;
  environment: string;
};

type CloudRegionSetting = {
  key: string;
  label: string;
  group: "gcp" | "tencent" | "database";
  fallbackDefault: string;
  readonly?: boolean;
  description?: string;
  effective: string;
  dbValue: string | null;
  envValue: string | null;
  source: "db" | "env" | "default";
};

type ApiState = {
  llm: ProviderRow[];
  storage: ProviderRow[];
  cloudRegions?: CloudRegionSetting[];
  driftCount?: number;
  db: { provider: string; host: string | null };
  active: {
    llm: string;
    storage: string;
    llmImageChain: string[];
    llmVoiceChain: string[];
  };
  routing: {
    scopes: {
      llm: RoutingScopeRow[];
      image: RoutingScopeRow[];
      voice: RoutingScopeRow[];
      storage: RoutingScopeRow[];
    };
    overrides: {
      llm: RouteOverrideRow[];
      image: RouteOverrideRow[];
      voice: RouteOverrideRow[];
      storage: RouteOverrideRow[];
    };
  };
  defaults: {
    llmImageChain: string[];
    llmVoiceChain: string[];
    voiceOptions: string[];
  };
  providerHealth: Record<string, ProviderHealthEntry>;
  canManage: boolean;
  deployHookConfigured: boolean;
  environment: Environment;
  currentVercelEnv: Environment | null;
};

type Environment = "production" | "preview" | "development";

type AuditRow = {
  id: string;
  changedAt: string;
  actorEmail: string | null;
  actorRole: string | null;
  category: string;
  configKey: string;
  environment: string;
  before: unknown;
  after: unknown;
  reason: string | null;
};

type ChainPickerOption = { value: string; label: string };

function ChainPicker({
  label,
  helpText,
  defaultLabel,
  available,
  value,
  onChange,
}: {
  label: string;
  helpText: string;
  defaultLabel: string;
  available: ChainPickerOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = value.filter((v) => available.some((o) => o.value === v));
  const unselected = available.filter((o) => !selected.includes(o.value));

  return (
    <div className="rounded-md border bg-slate-50 p-3 text-sm">
      <div className="font-medium text-slate-800">{label}</div>
      <p className="mt-0.5 text-xs text-slate-600">
        {helpText}{" "}
        <span className="text-slate-500">Default: {defaultLabel}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 min-h-[28px]">
        {selected.length === 0 ? (
          <span className="text-xs italic text-slate-500">
            (using default)
          </span>
        ) : (
          selected.map((v, i) => {
            const opt = available.find((o) => o.value === v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-xs font-medium text-white"
              >
                <span className="rounded-full bg-white/20 px-1 leading-none">
                  {i + 1}
                </span>
                {opt?.label ?? v}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== v))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/15"
                  aria-label={`Remove ${opt?.label ?? v}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })
        )}
      </div>
      {unselected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-xs text-slate-500">Add:</span>
          {unselected.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange([...selected, o.value])}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-900 hover:text-slate-900"
            >
              + {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type DraftState = {
  activeLlm: string;
  llmImageChain: string[];
  llmVoiceChain: string[];
  activeStorage: string;
  models: Record<string, { textModel?: string; imageModel?: string }>;
  /** Edited copies of routing scopes, keyed by `${category}:${scopeKey}`. */
  scopes: Record<
    string,
    { chain: string[]; enabled: boolean; priority: number }
  >;
  /** Edited copies of route overrides, keyed by `${category}:${routePattern}`. */
  overrides: Record<
    string,
    {
      chainOverride: string[];
      enabled: boolean;
      reason: string | null;
      isNew?: boolean;
      category: "llm" | "image" | "voice" | "storage";
      routePattern: string;
    }
  >;
  deletedOverrides: Array<{
    routePattern: string;
    category: "llm" | "image" | "voice" | "storage";
  }>;
  /** Edited cloud-region SystemConfig values, keyed by config key. */
  cloudRegions: Record<string, string>;
};

type DiffEntry = { label: string; before: string; after: string };

function diffDrafts(api: ApiState, draft: DraftState): DiffEntry[] {
  const out: DiffEntry[] = [];
  if (draft.activeLlm !== api.active.llm) {
    out.push({
      label: "Active LLM",
      before: api.active.llm,
      after: draft.activeLlm,
    });
  }
  if (draft.activeStorage !== api.active.storage) {
    out.push({
      label: "Active Storage",
      before: api.active.storage,
      after: draft.activeStorage,
    });
  }
  const before = api.active.llmImageChain.join(",") || "(default)";
  const after = draft.llmImageChain.join(",") || "(default)";
  if (before !== after) {
    out.push({ label: "Image chain", before, after });
  }
  const vBefore = api.active.llmVoiceChain.join(",") || "(default)";
  const vAfter = draft.llmVoiceChain.join(",") || "(default)";
  if (vBefore !== vAfter) {
    out.push({ label: "Voice chain", before: vBefore, after: vAfter });
  }
  for (const row of api.llm) {
    const draftEntry = draft.models[row.key];
    if (!draftEntry) continue;
    const textDefault = row.models.text?.default ?? "";
    const imageDefault = row.models.image?.default ?? "";
    if (
      draftEntry.textModel !== undefined &&
      draftEntry.textModel !== textDefault
    ) {
      out.push({
        label: `${row.displayName} text model`,
        before: textDefault || "(unset)",
        after: draftEntry.textModel || "(unset)",
      });
    }
    if (
      draftEntry.imageModel !== undefined &&
      draftEntry.imageModel !== imageDefault
    ) {
      out.push({
        label: `${row.displayName} image model`,
        before: imageDefault || "(unset)",
        after: draftEntry.imageModel || "(unset)",
      });
    }
  }

  // Routing scope diffs.
  const allScopes: RoutingScopeRow[] = [
    ...api.routing.scopes.llm,
    ...api.routing.scopes.image,
    ...api.routing.scopes.voice,
    ...api.routing.scopes.storage,
  ];
  for (const scope of allScopes) {
    const dk = `${scope.category}:${scope.scopeKey}`;
    const d = draft.scopes[dk];
    if (!d) continue;
    const beforeChain = scope.chain.join(",") || "(empty)";
    const afterChain = d.chain.join(",") || "(empty)";
    if (beforeChain !== afterChain) {
      out.push({
        label: `Scope ${scope.category}/${scope.scopeKey} chain`,
        before: beforeChain,
        after: afterChain,
      });
    }
    if (d.enabled !== scope.enabled) {
      out.push({
        label: `Scope ${scope.category}/${scope.scopeKey} enabled`,
        before: String(scope.enabled),
        after: String(d.enabled),
      });
    }
  }

  // Route override diffs.
  const allOverrides: RouteOverrideRow[] = [
    ...api.routing.overrides.llm,
    ...api.routing.overrides.image,
    ...api.routing.overrides.voice,
    ...api.routing.overrides.storage,
  ];
  for (const o of allOverrides) {
    const dk = `${o.category}:${o.routePattern}`;
    const d = draft.overrides[dk];
    if (!d) continue;
    const beforeChain = o.chainOverride.join(",") || "(empty)";
    const afterChain = d.chainOverride.join(",") || "(empty)";
    if (beforeChain !== afterChain) {
      out.push({
        label: `Override ${o.category} ${o.routePattern}`,
        before: beforeChain,
        after: afterChain,
      });
    }
    if (d.enabled !== o.enabled) {
      out.push({
        label: `Override ${o.category} ${o.routePattern} enabled`,
        before: String(o.enabled),
        after: String(d.enabled),
      });
    }
  }
  for (const [k, d] of Object.entries(draft.overrides)) {
    if (!d.isNew) continue;
    out.push({
      label: `New override ${d.category} ${d.routePattern}`,
      before: "(none)",
      after: d.chainOverride.join(",") || "(empty)",
    });
    void k;
  }
  for (const del of draft.deletedOverrides) {
    out.push({
      label: `Delete override ${del.category} ${del.routePattern}`,
      before: "(exists)",
      after: "(removed)",
    });
  }

  // Cloud region settings (Phase 4).
  for (const r of api.cloudRegions ?? []) {
    if (r.readonly) continue;
    const before = r.dbValue ?? "";
    const after = draft.cloudRegions?.[r.key] ?? "";
    if (before !== after) {
      out.push({
        label: `Region ${r.label} (${r.key})`,
        before: before || "(unset — using env/default)",
        after: after || "(unset — using env/default)",
      });
    }
  }
  return out;
}

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
        const draftModels: DraftState["models"] = {};
        for (const row of body.llm) {
          draftModels[row.key] = {
            textModel: row.models.text?.default ?? "",
            imageModel: row.models.image?.default ?? "",
          };
        }
        const draftScopes: DraftState["scopes"] = {};
        const allLoadedScopes = [
          ...body.routing.scopes.llm,
          ...body.routing.scopes.image,
          ...body.routing.scopes.voice,
          ...body.routing.scopes.storage,
        ];
        for (const s of allLoadedScopes) {
          draftScopes[`${s.category}:${s.scopeKey}`] = {
            chain: [...s.chain],
            enabled: s.enabled,
            priority: s.priority,
          };
        }
        const draftOverrides: DraftState["overrides"] = {};
        const allLoadedOverrides = [
          ...body.routing.overrides.llm,
          ...body.routing.overrides.image,
          ...body.routing.overrides.voice,
          ...body.routing.overrides.storage,
        ];
        for (const o of allLoadedOverrides) {
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
          // Pre-fill with the DB value (or empty string for "use env / default").
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
        setMessage(
          err instanceof Error ? err.message : "Failed to load providers",
        );
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

  const onApply = async () => {
    if (!data || !draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { environment };
      if (reason.trim()) body.reason = reason.trim();
      if (draft.activeLlm !== data.active.llm) body.activeLlm = draft.activeLlm;
      if (draft.activeStorage !== data.active.storage)
        body.activeStorage = draft.activeStorage;
      if (
        draft.llmImageChain.join(",") !== data.active.llmImageChain.join(",")
      ) {
        body.llmImageChain = draft.llmImageChain;
      }
      if (
        draft.llmVoiceChain.join(",") !== data.active.llmVoiceChain.join(",")
      ) {
        body.llmVoiceChain = draft.llmVoiceChain;
      }

      // Routing scope upserts — only changed rows.
      const allOriginalScopes = [
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
        matchRules: RoutingMatchRules;
        priority: number;
      }> = [];
      for (const orig of allOriginalScopes) {
        const dk = `${orig.category}:${orig.scopeKey}`;
        const d = draft.scopes[dk];
        if (!d) continue;
        const chainChanged = orig.chain.join(",") !== d.chain.join(",");
        const enabledChanged = orig.enabled !== d.enabled;
        const priorityChanged = orig.priority !== d.priority;
        if (chainChanged || enabledChanged || priorityChanged) {
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

      // Route override upserts/deletes.
      const overrideUpserts: Array<{
        routePattern: string;
        category: "llm" | "image" | "voice" | "storage";
        chainOverride: string[];
        enabled: boolean;
        reason?: string | null;
      }> = [];
      const allOriginalOverrides = [
        ...data.routing.overrides.llm,
        ...data.routing.overrides.image,
        ...data.routing.overrides.voice,
        ...data.routing.overrides.storage,
      ];
      const origByKey = new Map(
        allOriginalOverrides.map((o) => [`${o.category}:${o.routePattern}`, o]),
      );
      for (const [k, d] of Object.entries(draft.overrides)) {
        const orig = origByKey.get(k);
        if (!orig) {
          // new override
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
        const chainChanged =
          orig.chainOverride.join(",") !== d.chainOverride.join(",");
        const enabledChanged = orig.enabled !== d.enabled;
        const reasonChanged = (orig.reason ?? null) !== (d.reason ?? null);
        if (chainChanged || enabledChanged || reasonChanged) {
          overrideUpserts.push({
            routePattern: orig.routePattern,
            category: orig.category,
            chainOverride: d.chainOverride,
            enabled: d.enabled,
            reason: d.reason,
          });
        }
      }
      if (overrideUpserts.length > 0)
        body.routeOverrideUpserts = overrideUpserts;
      if (draft.deletedOverrides.length > 0)
        body.routeOverrideDeletes = draft.deletedOverrides;

      // Cloud-region SystemConfig writes (Phase 4 Regions tab).
      const regionUpserts: Array<{ key: string; value: string }> = [];
      for (const r of data.cloudRegions ?? []) {
        if (r.readonly) continue;
        const before = r.dbValue ?? "";
        const after = draft.cloudRegions?.[r.key] ?? "";
        if (before !== after) {
          // Only persist non-empty values; an empty edit means "delete the
          // override and let env/default win again". The POST schema rejects
          // empty values, so we send empty as a no-op via systemConfigUpserts
          // with the literal empty string — SystemConfig allows empty values.
          regionUpserts.push({ key: r.key, value: after });
        }
      }
      if (regionUpserts.length > 0) body.systemConfigUpserts = regionUpserts;

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
      setMessage(
        `Saved ${(json.updatedKeys ?? []).length} keys${deployBit}.`,
      );
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
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setLastResponse({
        deployTriggered: !!json.deployTriggered,
        deployError: null,
      });
      setMessage(
        json.deployTriggered ? "Deploy triggered." : "Deploy not triggered.",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setSaving(false);
    }
  };

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
        <Link href="/" className="text-blue-600">
          Sign in required
        </Link>
      </div>
    );
  }
  if (!data || !draft) {
    return (
      <div className="p-6 text-sm text-red-600">
        {message ?? "Failed to load."}
      </div>
    );
  }

  const llmOptions: ChainPickerOption[] = data.llm
    .filter((r) => r.enabled)
    .map((r) => ({ value: r.key, label: r.displayName }));
  const voiceOptions: ChainPickerOption[] = data.defaults.voiceOptions.map(
    (v) => ({ value: v, label: v }),
  );

  const showEnvWarning = environment !== "production";

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Admin
            </Button>
          </Link>
          <h1 className="text-xl font-semibold">Providers</h1>
          {data.canManage ? (
            <Badge variant="outline">Vercel sync ON</Badge>
          ) : (
            <Badge variant="outline">DB only</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <EnvironmentPills
            value={environment}
            onChange={(env) => {
              setEnvironment(env);
              void load(env);
            }}
            currentVercelEnv={data.currentVercelEnv}
          />
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw
              className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Reload
          </Button>
          <Button
            size="sm"
            onClick={() => setShowDiff(true)}
            disabled={diffEntries.length === 0 || saving}
          >
            <Save className="mr-1 h-4 w-4" />
            Apply ({diffEntries.length})
          </Button>
        </div>
      </div>

      {showEnvWarning && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            You are editing the <strong>{environment}</strong> environment.
            Changes here do <em>not</em> affect production traffic.
          </div>
        </div>
      )}

      {message && (
        <div className="mb-3 rounded-md border bg-slate-50 p-2 text-xs text-slate-700">
          {message}
          {lastResponse?.deployError && (
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              onClick={onRetryDeploy}
              disabled={saving}
            >
              Retry deploy
            </Button>
          )}
        </div>
      )}

      {(data.driftCount ?? 0) > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <strong>{data.driftCount}</strong> config{data.driftCount === 1 ? "" : "s"}{" "}
            drifted from Vercel.{" "}
            <Link
              href="/admin/providers/drift"
              className="font-medium underline"
            >
              Review drift →
            </Link>
          </div>
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="llm">LLM</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="db">Database</TabsTrigger>
          <TabsTrigger value="regions">Regions</TabsTrigger>
        </TabsList>

        {/* ---------------- LLM TAB ---------------- */}
        <TabsContent value="llm" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active LLM provider</CardTitle>
              <CardDescription>
                Default for non-WeChat traffic. WeChat-originated requests
                continue to use Hunyuan unless overridden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={draft.activeLlm}
                onValueChange={(v) =>
                  setDraft({ ...draft, activeLlm: v })
                }
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {llmOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <ChainPicker
                label="Image chain"
                helpText="Tried in order. First to return wins."
                defaultLabel={
                  data.defaults.llmImageChain.join(", ") || "(none)"
                }
                available={llmOptions}
                value={draft.llmImageChain}
                onChange={(next) =>
                  setDraft({ ...draft, llmImageChain: next })
                }
              />
              <ChainPicker
                label="Voice chain"
                helpText="TTS providers. Phase 1: hard-coded options."
                defaultLabel={
                  data.defaults.llmVoiceChain.join(", ") || "(none)"
                }
                available={voiceOptions}
                value={draft.llmVoiceChain}
                onChange={(next) =>
                  setDraft({ ...draft, llmVoiceChain: next })
                }
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">
              Registered LLM providers
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddLlm(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add provider
            </Button>
          </div>

          {data.llm.map((row) => {
            const health = data.providerHealth[row.key];
            const draftModel = draft.models[row.key] ?? {};
            return (
              <Card key={row.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {row.displayName}{" "}
                      <span className="ml-1 font-mono text-xs text-slate-500">
                        {row.key}
                      </span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <ProbeButton category="llm" providerKey={row.key} environment={environment} />
                      {health ? (
                        <Badge
                          variant={health.configured ? "default" : "destructive"}
                        >
                          {health.configured ? "configured" : "missing keys"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">unknown</Badge>
                      )}
                    </div>
                  </div>
                  {(row.metadata?.description as string | undefined) && (
                    <CardDescription>
                      {row.metadata?.description as string}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.envKeys).map(([slot, envName]) => (
                      <Badge
                        key={slot}
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {slot}: {envName}
                      </Badge>
                    ))}
                  </div>
                  {row.models.text && (
                    <div>
                      <label className="text-xs text-slate-600">
                        Text model{" "}
                        {row.models.text.envKey && (
                          <span className="font-mono text-[10px] text-slate-500">
                            ({row.models.text.envKey})
                          </span>
                        )}
                      </label>
                      <Input
                        value={
                          draftModel.textModel ??
                          row.models.text.default ??
                          ""
                        }
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            models: {
                              ...draft.models,
                              [row.key]: {
                                ...draftModel,
                                textModel: e.target.value,
                              },
                            },
                          })
                        }
                        className="max-w-md"
                      />
                    </div>
                  )}
                  {row.models.image && (
                    <div>
                      <label className="text-xs text-slate-600">
                        Image model{" "}
                        {row.models.image.envKey && (
                          <span className="font-mono text-[10px] text-slate-500">
                            ({row.models.image.envKey})
                          </span>
                        )}
                      </label>
                      <Input
                        value={
                          draftModel.imageModel ??
                          row.models.image.default ??
                          ""
                        }
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            models: {
                              ...draft.models,
                              [row.key]: {
                                ...draftModel,
                                imageModel: e.target.value,
                              },
                            },
                          })
                        }
                        className="max-w-md"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <RoutingScopesSection
            data={data}
            draft={draft}
            setDraft={setDraft}
            environment={environment}
          />

          <RouteOverridesSection
            data={data}
            draft={draft}
            setDraft={setDraft}
          />

          <RecentChangesPanel category="llm" environment={environment} />
        </TabsContent>

        {/* ---------------- STORAGE TAB ---------------- */}
        <TabsContent value="storage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> Active storage provider
              </CardTitle>
              <CardDescription>
                WeChat traffic is auto-routed to Tencent COS when configured.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={draft.activeStorage}
                onValueChange={(v) =>
                  setDraft({ ...draft, activeStorage: v })
                }
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.storage
                    .filter((r) => r.enabled)
                    .map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">
              Registered storage providers
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddStorage(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add storage provider
            </Button>
          </div>

          {data.storage.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {row.displayName}{" "}
                    <span className="ml-1 font-mono text-xs text-slate-500">
                      {row.key}
                    </span>
                  </CardTitle>
                  <ProbeButton category="storage" providerKey={row.key} environment={environment} />
                </div>
                {(row.metadata?.description as string | undefined) && (
                  <CardDescription>
                    {row.metadata?.description as string}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="text-sm">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(row.envKeys).map(([slot, envName]) => (
                    <Badge
                      key={slot}
                      variant="outline"
                      className="font-mono text-[10px]"
                    >
                      {slot}: {envName}
                    </Badge>
                  ))}
                  {Object.keys(row.envKeys).length === 0 && (
                    <span className="text-xs italic text-slate-500">
                      no env keys required
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          <RecentChangesPanel category="storage" environment={environment} />
        </TabsContent>

        {/* ---------------- DB TAB ---------------- */}
        <TabsContent value="db" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" /> Database
              </CardTitle>
              <CardDescription>
                Read-only. DB cutover requires manual coordination — see
                docs/RUNBOOK.md (postgres-cutover-runbook).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-slate-500">Provider: </span>
                <Badge variant="outline">{data.db.provider}</Badge>
              </div>
              <div>
                <span className="text-slate-500">Host: </span>
                <span className="font-mono text-xs">
                  {data.db.host ?? "(unknown)"}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- REGIONS TAB (Phase 4) ---------------- */}
        <TabsContent value="regions" className="space-y-4">
          {(["gcp", "tencent", "database"] as const).map((group) => {
            const rows = (data.cloudRegions ?? []).filter(
              (r) => r.group === group,
            );
            if (rows.length === 0) return null;
            const title =
              group === "gcp"
                ? "Google Cloud"
                : group === "tencent"
                  ? "Tencent Cloud"
                  : "Database";
            return (
              <Card key={group}>
                <CardHeader>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>
                    {group === "database"
                      ? "Read-only display. DB cutover requires manual coordination — see docs/RUNBOOK.md."
                      : "Edits write to SystemConfig. Apply syncs to Vercel + redeploys."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {rows.map((r) => {
                    const draftValue = draft.cloudRegions?.[r.key] ?? "";
                    return (
                      <div key={r.key} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-slate-700">
                            {r.label}
                          </label>
                          <span className="font-mono text-[10px] text-slate-500">
                            {r.key}
                          </span>
                          {r.source === "env" && (
                            <Badge variant="outline" className="text-[10px]">
                              env-only
                            </Badge>
                          )}
                          {r.source === "default" && (
                            <Badge variant="outline" className="text-[10px]">
                              default
                            </Badge>
                          )}
                          {r.source === "db" && (
                            <Badge variant="default" className="text-[10px]">
                              db override
                            </Badge>
                          )}
                          {r.readonly && (
                            <Badge variant="outline" className="text-[10px]">
                              read-only
                            </Badge>
                          )}
                        </div>
                        {r.readonly ? (
                          <div className="rounded border bg-slate-50 px-2 py-1 font-mono text-xs">
                            {r.effective || "(unset)"}
                          </div>
                        ) : (
                          <Input
                            value={draftValue}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                cloudRegions: {
                                  ...draft.cloudRegions,
                                  [r.key]: e.target.value,
                                },
                              })
                            }
                            placeholder={
                              r.envValue
                                ? `env: ${r.envValue}`
                                : r.fallbackDefault
                                  ? `default: ${r.fallbackDefault}`
                                  : "(empty — uses env / default)"
                            }
                            className="font-mono text-xs"
                          />
                        )}
                        <div className="text-[11px] text-slate-500">
                          {r.description && <div>{r.description}</div>}
                          <div>
                            <span className="text-slate-400">env:</span>{" "}
                            <span className="font-mono">
                              {r.envValue ?? "(unset)"}
                            </span>{" "}
                            <span className="text-slate-400">• default:</span>{" "}
                            <span className="font-mono">
                              {r.fallbackDefault || "(none)"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
          {(data.cloudRegions ?? []).length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-slate-500">
                No cloud-region settings registered.
              </CardContent>
            </Card>
          )}

          <ExportImportSection environment={environment} onImported={() => load()} />
        </TabsContent>
      </Tabs>

      {/* ---------------- DIFF DIALOG ---------------- */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm changes</DialogTitle>
            <DialogDescription>
              {diffEntries.length} change(s) will be written to SystemConfig
              <strong> ({environment})</strong> and (when configured) synced
              to Vercel + redeploy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
            {diffEntries.map((d, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_2fr] gap-2 rounded border p-2"
              >
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
              Why are you making this change?{" "}
              <span className="font-normal text-slate-500">
                (optional, recorded in audit log)
              </span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. rotating leaked OpenAI API key"
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDiff(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={onApply} disabled={saving || diffEntries.length === 0}>
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="mr-1 h-4 w-4" />
              )}
              Confirm & Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- ADD PROVIDER DIALOGS ---------------- */}
      <AddProviderDialog
        open={showAddLlm}
        category="llm"
        onClose={() => setShowAddLlm(false)}
        onSaved={() => load()}
      />
      <AddProviderDialog
        open={showAddStorage}
        category="storage"
        onClose={() => setShowAddStorage(false)}
        onSaved={() => load()}
      />
    </div>
  );
}

function ExportImportSection({
  environment,
  onImported,
}: {
  environment: Environment;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [importPayload, setImportPayload] = useState<string>("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importDryResult, setImportDryResult] = useState<unknown>(null);
  const [importConfirmReplace, setImportConfirmReplace] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [secretsDialogOpen, setSecretsDialogOpen] = useState(false);

  const downloadJson = (filename: string, body: unknown) => {
    const blob = new Blob([JSON.stringify(body, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onExport = async (includeSecrets: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const url = `/api/admin/providers/export?environment=${encodeURIComponent(environment)}${includeSecrets ? "&includeSecrets=true" : ""}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: includeSecrets ? { "X-Confirm-Sensitive": "yes" } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadJson(
        `providers-${environment}-${stamp}${includeSecrets ? "-with-secrets" : ""}.json`,
        body,
      );
      setMessage(
        `Exported (${includeSecrets ? "with secrets" : "secrets redacted"}).`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setSecretsDialogOpen(false);
      setConfirmSecrets(false);
    }
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    try {
      JSON.parse(text);
      setImportPayload(text);
      setImportDryResult(null);
      setImportDialogOpen(true);
    } catch {
      setMessage("Invalid JSON file.");
    }
  };

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(importPayload) as {
        registry?: unknown;
        systemConfig?: unknown;
        routingScopes?: unknown;
        routeOverrides?: unknown;
      };
      const res = await fetch("/api/admin/providers/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: importMode,
          dryRun,
          environment,
          payload: {
            registry: parsed.registry,
            systemConfig: parsed.systemConfig,
            routingScopes: parsed.routingScopes,
            routeOverrides: parsed.routeOverrides,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (dryRun) {
        setImportDryResult(body);
        setMessage("Dry run OK — review the diff and confirm.");
      } else {
        setMessage(
          `Import applied (${importMode}). ${body.summary?.skippedRedactedKeys?.length ?? 0} redacted keys skipped.`,
        );
        setImportDialogOpen(false);
        setImportPayload("");
        setImportDryResult(null);
        setImportConfirmReplace("");
        onImported();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export / Import</CardTitle>
        <CardDescription>
          Snapshot the {environment} provider config (registry, SystemConfig,
          routing scopes, route overrides) as a JSON file. Sensitive values
          are redacted unless you explicitly confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onExport(false)}
            disabled={busy}
          >
            Export {environment} JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSecretsDialogOpen(true)}
            disabled={busy}
          >
            Export with secrets…
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" asChild disabled={busy}>
              <span>Import…</span>
            </Button>
          </label>
        </div>
        {message && (
          <div className="rounded border bg-slate-50 p-2 text-xs">
            {message}
          </div>
        )}
      </CardContent>

      {/* Secrets confirm dialog */}
      <Dialog open={secretsDialogOpen} onOpenChange={setSecretsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export with secrets</DialogTitle>
            <DialogDescription>
              The exported file will contain plaintext API keys, secrets, and
              tokens. Treat it like a credential dump. Two confirmations
              required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={confirmSecrets}
                onChange={(e) => setConfirmSecrets(e.target.checked)}
                className="mt-1"
              />
              <span>
                I understand this file contains live secrets and I will store
                it only in an encrypted location, never in plaintext logs,
                Slack, email, or git.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setSecretsDialogOpen(false);
                setConfirmSecrets(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => onExport(true)}
              disabled={!confirmSecrets || busy}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Confirm & Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import provider config</DialogTitle>
            <DialogDescription>
              Target environment: <strong>{environment}</strong>. Run a dry
              run first to review what will change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={importMode === "merge"}
                  onChange={() => setImportMode("merge")}
                />
                Merge (upsert; keep extras)
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                />
                Replace (delete-then-insert)
              </label>
            </div>
            {importMode === "replace" && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
                <strong>Replace mode</strong> deletes every SystemConfig /
                routing scope / route override row in {environment}. Type{" "}
                <code className="rounded bg-white px-1">replace {environment}</code>{" "}
                to confirm.
                <Input
                  value={importConfirmReplace}
                  onChange={(e) => setImportConfirmReplace(e.target.value)}
                  className="mt-2 font-mono text-xs"
                  placeholder={`replace ${environment}`}
                />
              </div>
            )}
            {importDryResult !== null && (
              <pre className="max-h-64 overflow-auto rounded border bg-slate-50 p-2 font-mono text-[10px]">
                {JSON.stringify(importDryResult, null, 2)}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setImportDialogOpen(false);
                setImportPayload("");
                setImportDryResult(null);
                setImportConfirmReplace("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => runImport(true)}
              disabled={busy}
            >
              Dry run
            </Button>
            <Button
              onClick={() => runImport(false)}
              disabled={
                busy ||
                importDryResult === null ||
                (importMode === "replace" &&
                  importConfirmReplace !== `replace ${environment}`)
              }
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EnvironmentPills({
  value,
  onChange,
  currentVercelEnv,
}: {
  value: Environment;
  onChange: (env: Environment) => void;
  currentVercelEnv: Environment | null;
}) {
  const opts: Environment[] = ["production", "preview", "development"];
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border"
      role="group"
      aria-label="Environment"
    >
      {opts.map((env) => (
        <button
          key={env}
          type="button"
          onClick={() => onChange(env)}
          className={`px-2.5 py-1 text-xs font-medium transition ${
            value === env
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-700 hover:bg-slate-100"
          }`}
          title={
            currentVercelEnv === env
              ? "Current Vercel deployment env"
              : undefined
          }
        >
          {env}
          {currentVercelEnv === env && (
            <span className="ml-1 text-[10px] opacity-70">●</span>
          )}
        </button>
      ))}
    </div>
  );
}

type ProbeState =
  | { status: "idle" }
  | { status: "pending" }
  | {
      status: "done";
      ok: boolean;
      latencyMs: number;
      sampleOutput?: string;
      error?: string;
      cached?: boolean;
    };

function ProbeButton({
  category,
  providerKey,
  environment,
}: {
  category: string;
  providerKey: string;
  environment: Environment;
}) {
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  const onTest = async () => {
    setState({ status: "pending" });
    try {
      const res = await fetch("/api/admin/providers/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, key: providerKey, environment }),
      });
      const json = await res.json();
      setState({
        status: "done",
        ok: !!json.ok,
        latencyMs: typeof json.latencyMs === "number" ? json.latencyMs : 0,
        sampleOutput: json.sampleOutput,
        error: json.error,
        cached: !!json.cached,
      });
    } catch (err) {
      setState({
        status: "done",
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "probe failed",
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={state.status === "pending"}
      >
        {state.status === "pending" ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Activity className="mr-1 h-3 w-3" />
        )}
        Test now
      </Button>
      {state.status === "done" && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            state.ok ? "text-emerald-700" : "text-red-700"
          }`}
          title={state.sampleOutput ?? state.error ?? ""}
        >
          {state.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {state.ok
            ? `${state.latencyMs}ms${state.cached ? " (cached)" : ""}`
            : (state.error ?? "fail").slice(0, 60)}
        </span>
      )}
    </div>
  );
}

function RecentChangesPanel({
  category,
  environment,
}: {
  category: string;
  environment: Environment;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/providers/audit?category=${encodeURIComponent(category)}&environment=${encodeURIComponent(environment)}&limit=10`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [category, environment]);

  useEffect(() => {
    if (open && rows === null) void fetchRows();
  }, [open, rows, fetchRows]);

  // Refetch when env or category changes if panel is open.
  useEffect(() => {
    if (open) {
      setRows(null);
      void fetchRows();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, category]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4" />
            Recent changes ({category})
          </CardTitle>
          <span className="text-xs text-slate-500">
            {open ? "Hide" : "Show"}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="text-xs">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {err && <p className="text-red-600">{err}</p>}
          {rows && rows.length === 0 && (
            <p className="italic text-slate-500">No recent changes.</p>
          )}
          {rows && rows.length > 0 && (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={r.id} className="rounded border p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-slate-700">
                      {r.configKey}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(r.changedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                    <Badge variant="outline" className="text-[10px]">
                      {r.actorEmail ?? r.actorRole ?? "system"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {r.environment}
                    </Badge>
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-600">
                    <span className="line-through text-red-700">
                      {summarize(r.before)}
                    </span>{" "}
                    →{" "}
                    <span className="text-emerald-700">
                      {summarize(r.after)}
                    </span>
                  </div>
                  {r.reason && (
                    <p className="mt-0.5 text-[10px] italic text-slate-500">
                      “{r.reason}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <Link
              href={`/admin/providers/audit?category=${encodeURIComponent(category)}&environment=${encodeURIComponent(environment)}`}
              className="text-blue-600 underline"
            >
              View all
            </Link>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function summarize(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(v);
  }
}

function AddProviderDialog({
  open,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [envKeysJson, setEnvKeysJson] = useState(
    '{\n  "apiKey": "MY_PROVIDER_API_KEY"\n}',
  );
  const [modelsJson, setModelsJson] = useState(
    '{\n  "text": { "envKey": "MY_PROVIDER_TEXT_MODEL", "default": "" }\n}',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKey("");
    setDisplayName("");
    setError(null);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      let envKeys: Record<string, string>;
      let models: Record<string, unknown>;
      try {
        envKeys = JSON.parse(envKeysJson);
      } catch {
        throw new Error("envKeys is not valid JSON");
      }
      try {
        models = JSON.parse(modelsJson);
      } catch {
        throw new Error("models is not valid JSON");
      }
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerUpserts: [
            {
              category,
              key: key.trim(),
              displayName: displayName.trim(),
              envKeys,
              models,
            },
          ],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      reset();
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {category} provider</DialogTitle>
          <DialogDescription>
            Inserts a row into ProviderRegistry. The adapter still has to
            ship as code — this just registers metadata.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-slate-600">key (slug)</label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. claude"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Display name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Anthropic Claude"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">envKeys (JSON)</label>
            <Textarea
              value={envKeysJson}
              onChange={(e) => setEnvKeysJson(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">models (JSON)</label>
            <Textarea
              value={modelsJson}
              onChange={(e) => setModelsJson(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !key.trim() || !displayName.trim()}
          >
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Routing scopes + Route overrides sections
// ---------------------------------------------------------------------------

function MatchRulesBadges({ rules }: { rules: RoutingMatchRules }) {
  const entries: string[] = [];
  if (rules.isWeChat !== undefined) {
    entries.push(rules.isWeChat ? "isWeChat=true" : "isWeChat=false");
  }
  if (rules.region) entries.push(`region=${rules.region}`);
  if (rules.userAgent) entries.push(`UA~${rules.userAgent}`);
  if (rules.header) {
    for (const [k, v] of Object.entries(rules.header)) {
      entries.push(`${k}=${v}`);
    }
  }
  if (entries.length === 0) {
    return (
      <Badge variant="outline" className="text-[10px]">
        catch-all
      </Badge>
    );
  }
  return (
    <>
      {entries.map((e, i) => (
        <Badge key={i} variant="outline" className="font-mono text-[10px]">
          {e}
        </Badge>
      ))}
    </>
  );
}

function RoutingScopesSection({
  data,
  draft,
  setDraft,
  environment,
}: {
  data: ApiState;
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  environment: Environment;
}) {
  const [activeCategory, setActiveCategory] = useState<
    "llm" | "image" | "voice"
  >("llm");

  const optionsByCategory: Record<"llm" | "image" | "voice", ChainPickerOption[]> =
    {
      llm: data.llm
        .filter((r) => {
          const caps = (r.metadata?.capabilities ?? []) as unknown[];
          return (
            r.enabled && (!Array.isArray(caps) || !caps.includes("voice"))
          );
        })
        .map((r) => ({ value: r.key, label: r.displayName })),
      image: data.llm
        .filter((r) => r.enabled && r.metadata?.supportsImage)
        .map((r) => ({ value: r.key, label: r.displayName })),
      voice: data.defaults.voiceOptions.map((v) => ({ value: v, label: v })),
    };

  const scopes = data.routing.scopes[activeCategory];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Routing scopes</CardTitle>
            <CardDescription>
              Per-surface chains. Lowest priority that matches the request
              wins. Empty rules = catch-all.
            </CardDescription>
          </div>
          <div className="inline-flex overflow-hidden rounded-md border text-xs">
            {(["llm", "image", "voice"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 font-medium transition ${
                  activeCategory === cat
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {scopes.length === 0 && (
          <p className="text-xs italic text-slate-500">
            No scopes seeded yet for {activeCategory}. Run{" "}
            <code className="rounded bg-slate-100 px-1">
              scripts/seed-provider-registry.mjs
            </code>{" "}
            or POST a routingScopeUpserts payload.
          </p>
        )}
        {scopes.map((scope) => {
          const dk = `${scope.category}:${scope.scopeKey}`;
          const d = draft.scopes[dk] ?? {
            chain: [...scope.chain],
            enabled: scope.enabled,
            priority: scope.priority,
          };
          return (
            <div key={scope.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {scope.displayName}{" "}
                    <span className="ml-1 font-mono text-xs text-slate-500">
                      {scope.scopeKey}
                    </span>
                  </div>
                  {scope.description && (
                    <p className="text-xs text-slate-600">
                      {scope.description}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <MatchRulesBadges rules={scope.matchRules} />
                    <Badge variant="outline" className="text-[10px]">
                      priority {scope.priority}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ScopeProbeButton
                    category={scope.category}
                    matchRules={scope.matchRules}
                    environment={environment}
                  />
                  <label className="flex items-center gap-1 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scopes: {
                            ...draft.scopes,
                            [dk]: { ...d, enabled: e.target.checked },
                          },
                        })
                      }
                    />
                    enabled
                  </label>
                </div>
              </div>
              <div className="mt-2">
                <ChainPicker
                  label="Chain"
                  helpText="Tried in order; first to succeed wins."
                  defaultLabel={scope.chain.join(", ") || "(empty)"}
                  available={optionsByCategory[activeCategory]}
                  value={d.chain}
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      scopes: {
                        ...draft.scopes,
                        [dk]: { ...d, chain: next },
                      },
                    })
                  }
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScopeProbeButton({
  category,
  matchRules,
  environment,
}: {
  category: "llm" | "image" | "voice" | "storage";
  matchRules: RoutingMatchRules;
  environment: Environment;
}) {
  const [state, setState] = useState<ProbeState>({ status: "idle" });
  const onTest = async () => {
    setState({ status: "pending" });
    try {
      const res = await fetch("/api/admin/providers/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "scope",
          category,
          matchRules,
          environment,
        }),
      });
      const json = await res.json();
      setState({
        status: "done",
        ok: !!json.ok,
        latencyMs: typeof json.latencyMs === "number" ? json.latencyMs : 0,
        sampleOutput: json.sampleOutput,
        error: json.error,
      });
    } catch (err) {
      setState({
        status: "done",
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "probe failed",
      });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={state.status === "pending"}
      >
        {state.status === "pending" ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Activity className="mr-1 h-3 w-3" />
        )}
        Test now
      </Button>
      {state.status === "done" && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            state.ok ? "text-emerald-700" : "text-red-700"
          }`}
          title={state.sampleOutput ?? state.error ?? ""}
        >
          {state.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {state.ok
            ? `${state.latencyMs}ms`
            : (state.error ?? "fail").slice(0, 60)}
        </span>
      )}
    </div>
  );
}

function RouteOverridesSection({
  data,
  draft,
  setDraft,
}: {
  data: ApiState;
  draft: DraftState;
  setDraft: (d: DraftState) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [activeCategory, setActiveCategory] = useState<
    "llm" | "image" | "voice"
  >("llm");

  const optionsByCategory: Record<"llm" | "image" | "voice", ChainPickerOption[]> =
    {
      llm: data.llm
        .filter((r) => {
          const caps = (r.metadata?.capabilities ?? []) as unknown[];
          return (
            r.enabled && (!Array.isArray(caps) || !caps.includes("voice"))
          );
        })
        .map((r) => ({ value: r.key, label: r.displayName })),
      image: data.llm
        .filter((r) => r.enabled && r.metadata?.supportsImage)
        .map((r) => ({ value: r.key, label: r.displayName })),
      voice: data.defaults.voiceOptions.map((v) => ({ value: v, label: v })),
    };

  const overrides = data.routing.overrides[activeCategory];
  const newOverrides = Object.values(draft.overrides).filter(
    (o) => o.isNew && o.category === activeCategory,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Route overrides</CardTitle>
            <CardDescription>
              Per-route chain overrides. Wins over the matching scope.
              Pattern supports trailing <code>*</code> wildcard.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              {(["llm", "image", "voice"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 font-medium transition ${
                    activeCategory === cat
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add override
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {overrides.length === 0 && newOverrides.length === 0 && (
          <p className="text-xs italic text-slate-500">
            No overrides for {activeCategory}. Click &ldquo;Add override&rdquo;
            to create one.
          </p>
        )}
        {overrides.map((o) => {
          const dk = `${o.category}:${o.routePattern}`;
          const d = draft.overrides[dk] ?? {
            chainOverride: [...o.chainOverride],
            enabled: o.enabled,
            reason: o.reason,
            category: o.category,
            routePattern: o.routePattern,
          };
          const isPendingDelete = draft.deletedOverrides.some(
            (x) => x.routePattern === o.routePattern && x.category === o.category,
          );
          return (
            <div
              key={o.id}
              className={`rounded-md border p-3 ${
                isPendingDelete ? "opacity-50 line-through" : ""
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs">{o.routePattern}</div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      disabled={isPendingDelete}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          overrides: {
                            ...draft.overrides,
                            [dk]: { ...d, enabled: e.target.checked },
                          },
                        })
                      }
                    />
                    enabled
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        deletedOverrides: isPendingDelete
                          ? draft.deletedOverrides.filter(
                              (x) =>
                                !(
                                  x.routePattern === o.routePattern &&
                                  x.category === o.category
                                ),
                            )
                          : [
                              ...draft.deletedOverrides,
                              {
                                routePattern: o.routePattern,
                                category: o.category,
                              },
                            ],
                      })
                    }
                  >
                    {isPendingDelete ? "Undo" : "Delete"}
                  </Button>
                </div>
              </div>
              {o.reason && (
                <p className="mt-1 text-[11px] italic text-slate-500">
                  {o.reason}
                </p>
              )}
              <div className="mt-2">
                <ChainPicker
                  label="Chain override"
                  helpText="Replaces the scope's chain for this route."
                  defaultLabel={o.chainOverride.join(", ") || "(empty)"}
                  available={optionsByCategory[activeCategory]}
                  value={d.chainOverride}
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      overrides: {
                        ...draft.overrides,
                        [dk]: { ...d, chainOverride: next },
                      },
                    })
                  }
                />
              </div>
            </div>
          );
        })}
        {newOverrides.map((d) => {
          const dk = `${d.category}:${d.routePattern}`;
          return (
            <div key={dk} className="rounded-md border border-emerald-300 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs">
                  {d.routePattern}{" "}
                  <Badge className="ml-1 bg-emerald-600 text-[10px]">new</Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => {
                    const next = { ...draft.overrides };
                    delete next[dk];
                    setDraft({ ...draft, overrides: next });
                  }}
                >
                  Remove
                </Button>
              </div>
              <div className="mt-2">
                <ChainPicker
                  label="Chain override"
                  helpText="Replaces the scope's chain for this route."
                  defaultLabel="(empty)"
                  available={optionsByCategory[activeCategory]}
                  value={d.chainOverride}
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      overrides: {
                        ...draft.overrides,
                        [dk]: { ...d, chainOverride: next },
                      },
                    })
                  }
                />
              </div>
            </div>
          );
        })}
      </CardContent>
      <AddOverrideDialog
        open={showAdd}
        category={activeCategory}
        onClose={() => setShowAdd(false)}
        onSave={(routePattern, reason) => {
          const dk = `${activeCategory}:${routePattern}`;
          if (draft.overrides[dk]) return;
          setDraft({
            ...draft,
            overrides: {
              ...draft.overrides,
              [dk]: {
                chainOverride: [],
                enabled: true,
                reason,
                isNew: true,
                category: activeCategory,
                routePattern,
              },
            },
          });
        }}
      />
    </Card>
  );
}

function AddOverrideDialog({
  open,
  category,
  onClose,
  onSave,
}: {
  open: boolean;
  category: "llm" | "image" | "voice" | "storage";
  onClose: () => void;
  onSave: (routePattern: string, reason: string | null) => void;
}) {
  const [routePattern, setRoutePattern] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setRoutePattern("");
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {category} route override</DialogTitle>
          <DialogDescription>
            Match by exact path or use a trailing <code>*</code> wildcard
            (e.g. <code>/api/voice-chat/*</code>). Apply to commit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-slate-600">Route pattern</label>
            <Input
              value={routePattern}
              onChange={(e) => setRoutePattern(e.target.value)}
              placeholder="/api/match"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Reason (optional)</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. cheaper model for matchmaking"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!routePattern.trim()) return;
              onSave(routePattern.trim(), reason.trim() || null);
              setRoutePattern("");
              setReason("");
              onClose();
            }}
            disabled={!routePattern.trim()}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
