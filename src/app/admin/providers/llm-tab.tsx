"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

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

import type {
  ApiState,
  DraftState,
  Environment,
  ChainPickerOption,
} from "./shared-types";
import { ChainPicker } from "./chain-picker";
import {
  ProbeButton,
  ScopeProbeButton,
  MatchRulesBadges,
  AddOverrideDialog,
  RecentChangesPanel,
} from "./shared-components";

// ---------------------------------------------------------------------------
// Routing Scopes Section (included in LLM tab)
// ---------------------------------------------------------------------------

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

  const optionsByCategory: Record<
    "llm" | "image" | "voice",
    ChainPickerOption[]
  > = {
    llm: data.llm
      .filter((r) => {
        const caps = (r.metadata?.capabilities ?? []) as unknown[];
        return r.enabled && (!Array.isArray(caps) || !caps.includes("voice"));
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

// ---------------------------------------------------------------------------
// Route Overrides Section (included in LLM tab)
// ---------------------------------------------------------------------------

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

  const optionsByCategory: Record<
    "llm" | "image" | "voice",
    ChainPickerOption[]
  > = {
    llm: data.llm
      .filter((r) => {
        const caps = (r.metadata?.capabilities ?? []) as unknown[];
        return r.enabled && (!Array.isArray(caps) || !caps.includes("voice"));
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
            (x) =>
              x.routePattern === o.routePattern && x.category === o.category,
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
            <div
              key={dk}
              className="rounded-md border border-emerald-300 p-3"
            >
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

// ---------------------------------------------------------------------------
// LLM Tab
// ---------------------------------------------------------------------------

interface LlmTabProps {
  data: ApiState;
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  environment: Environment;
  onShowAddLlm: () => void;
}

export function LlmTab({
  data,
  draft,
  setDraft,
  environment,
  onShowAddLlm,
}: LlmTabProps) {
  const llmOptions: ChainPickerOption[] = data.llm
    .filter((r) => r.enabled)
    .map((r) => ({ value: r.key, label: r.displayName }));
  const voiceOptions: ChainPickerOption[] = data.defaults.voiceOptions.map(
    (v) => ({ value: v, label: v }),
  );

  return (
    <div className="space-y-4">
      {/* Active LLM + chains */}
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
            onValueChange={(v) => setDraft({ ...draft, activeLlm: v })}
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
            defaultLabel={data.defaults.llmImageChain.join(", ") || "(none)"}
            available={llmOptions}
            value={draft.llmImageChain}
            onChange={(next) => setDraft({ ...draft, llmImageChain: next })}
          />
          <ChainPicker
            label="Voice chain"
            helpText="TTS providers."
            defaultLabel={
              data.defaults.llmVoiceChain.join(", ") || "(none)"
            }
            available={voiceOptions}
            value={draft.llmVoiceChain}
            onChange={(next) => setDraft({ ...draft, llmVoiceChain: next })}
          />
        </CardContent>
      </Card>

      {/* Registered LLM providers */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">
          Registered LLM providers
        </h2>
        <Button size="sm" variant="outline" onClick={onShowAddLlm}>
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
                  <ProbeButton
                    category="llm"
                    providerKey={row.key}
                    environment={environment}
                  />
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
    </div>
  );
}
