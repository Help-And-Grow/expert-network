"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Environment } from "./shared-types";

/**
 * Export/Import section for Regions tab. Exports provider config
 * (registry, SystemConfig, routing scopes, route overrides) as JSON.
 */
export function ExportImportSection({
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
