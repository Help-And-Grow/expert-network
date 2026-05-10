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

type ApiState = {
  llm: ProviderRow[];
  storage: ProviderRow[];
  db: { provider: string; host: string | null };
  active: {
    llm: string;
    storage: string;
    llmImageChain: string[];
    llmVoiceChain: string[];
  };
  defaults: {
    llmImageChain: string[];
    llmVoiceChain: string[];
    voiceOptions: string[];
  };
  providerHealth: Record<string, ProviderHealthEntry>;
  canManage: boolean;
  deployHookConfigured: boolean;
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
  return out;
}

export default function ProvidersClient() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") || "llm";

  const [data, setData] = useState<ApiState | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showAddLlm, setShowAddLlm] = useState(false);
  const [showAddStorage, setShowAddStorage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/providers", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ApiState;
      setData(body);
      const draftModels: DraftState["models"] = {};
      for (const row of body.llm) {
        draftModels[row.key] = {
          textModel: row.models.text?.default ?? "",
          imageModel: row.models.image?.default ?? "",
        };
      }
      setDraft({
        activeLlm: body.active.llm,
        llmImageChain: [...body.active.llmImageChain],
        llmVoiceChain: [...body.active.llmVoiceChain],
        activeStorage: body.active.storage,
        models: draftModels,
      });
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to load providers",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status, load]);

  const diffEntries = useMemo(
    () => (data && draft ? diffDrafts(data, draft) : []),
    [data, draft],
  );

  const onApply = async () => {
    if (!data || !draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
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
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMessage(
        `Saved ${(json.updatedKeys ?? []).length} keys${
          json.deployTriggered ? " — deploy triggered" : ""
        }.`,
      );
      setShowDiff(false);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
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

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
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

      {message && (
        <div className="mb-3 rounded-md border bg-slate-50 p-2 text-xs text-slate-700">
          {message}
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="llm">LLM</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="db">Database</TabsTrigger>
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
                <CardTitle className="text-base">
                  {row.displayName}{" "}
                  <span className="ml-1 font-mono text-xs text-slate-500">
                    {row.key}
                  </span>
                </CardTitle>
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
                      variant={
                        process_env_has(envName) ? "default" : "destructive"
                      }
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
      </Tabs>

      {/* ---------------- DIFF DIALOG ---------------- */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm changes</DialogTitle>
            <DialogDescription>
              {diffEntries.length} change(s) will be written to SystemConfig
              and (when configured) synced to Vercel + redeploy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
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
        onSaved={load}
      />
      <AddProviderDialog
        open={showAddStorage}
        category="storage"
        onClose={() => setShowAddStorage(false)}
        onSaved={load}
      />
    </div>
  );
}

/**
 * Client-side guess at whether an env var is set in the *runtime* environment.
 * We can't read process.env from a "use client" file, so this returns true to
 * keep the UI from spuriously flagging keys; the providerHealth map computed
 * by the API is the authoritative source for LLM rows.
 */
function process_env_has(_envName: string): boolean {
  return true;
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
