"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  History,
  Loader2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import type {
  Environment,
  RoutingMatchRules,
  AuditRow,
  ProbeState,
} from "./shared-types";

// ---------------------------------------------------------------------------
// EnvironmentPills
// ---------------------------------------------------------------------------

export function EnvironmentPills({
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

// ---------------------------------------------------------------------------
// ProbeButton
// ---------------------------------------------------------------------------

export function ProbeButton({
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

// ---------------------------------------------------------------------------
// ScopeProbeButton
// ---------------------------------------------------------------------------

export function ScopeProbeButton({
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

// ---------------------------------------------------------------------------
// MatchRulesBadges
// ---------------------------------------------------------------------------

export function MatchRulesBadges({ rules }: { rules: RoutingMatchRules }) {
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

// ---------------------------------------------------------------------------
// RecentChangesPanel
// ---------------------------------------------------------------------------

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

export function RecentChangesPanel({
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
                      &ldquo;{r.reason}&rdquo;
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

// ---------------------------------------------------------------------------
// AddProviderDialog
// ---------------------------------------------------------------------------

export function AddProviderDialog({
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
// AddOverrideDialog
// ---------------------------------------------------------------------------

export function AddOverrideDialog({
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
