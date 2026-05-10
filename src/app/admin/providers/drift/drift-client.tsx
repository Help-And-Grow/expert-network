"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type DriftRow = {
  id: string;
  detectedAt: string;
  configKey: string;
  environment: string;
  dbValue: string | null;
  vercelValue: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedNote: string | null;
};

type ApiResponse = {
  rows: DriftRow[];
  unresolvedCount: number;
};

type ConfirmState = {
  row: DriftRow;
  direction: "push" | "pull" | "note";
} | null;

export default function DriftClient() {
  const { status } = useSession();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showResolved) params.set("resolved", "false");
      const res = await fetch(`/api/admin/providers/drift?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ApiResponse;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const onResolve = async () => {
    if (!confirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/providers/drift/${confirm.row.id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            direction: confirm.direction,
            note: reason.trim() || undefined,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirm(null);
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (status !== "authenticated") {
    return (
      <div className="p-6 text-sm text-slate-600">
        Sign in as an admin to view drift.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/admin/providers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Providers
            </Button>
          </Link>
          <h1 className="text-xl font-semibold">Provider config drift</h1>
          {data && data.unresolvedCount > 0 && (
            <Badge variant="destructive">{data.unresolvedCount} unresolved</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw
              className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Reload
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="p-6 text-center text-sm text-slate-500">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
            No drift detected. SystemConfig and Vercel env are in sync for the
            keys we monitor.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono text-sm">
                    {row.configKey}{" "}
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      ({row.environment})
                    </span>
                  </CardTitle>
                  {row.resolved ? (
                    <Badge variant="outline">resolved</Badge>
                  ) : (
                    <Badge variant="destructive">drift</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded border bg-slate-50 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      DB value
                    </div>
                    <div className="break-all font-mono text-xs">
                      {row.dbValue ?? <em className="text-slate-400">(unset)</em>}
                    </div>
                  </div>
                  <div className="rounded border bg-slate-50 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Vercel value
                    </div>
                    <div className="break-all font-mono text-xs">
                      {row.vercelValue ?? (
                        <em className="text-slate-400">(unset)</em>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Detected{" "}
                  {new Date(row.detectedAt).toLocaleString("en-SG", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  {row.resolvedAt && (
                    <>
                      {" "}
                      • Resolved{" "}
                      {new Date(row.resolvedAt).toLocaleString("en-SG", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}{" "}
                      by {row.resolvedBy ?? "(unknown)"}
                    </>
                  )}
                  {row.resolvedNote && (
                    <>
                      <br />
                      Note: {row.resolvedNote}
                    </>
                  )}
                </div>
                {!row.resolved && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => setConfirm({ row, direction: "push" })}
                      disabled={row.dbValue === null}
                    >
                      Push DB → Vercel
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirm({ row, direction: "pull" })}
                      disabled={row.vercelValue === null}
                    >
                      Pull Vercel → DB
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirm({ row, direction: "note" })}
                    >
                      Mark as intentional
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.direction === "push" && "Push DB value to Vercel"}
              {confirm?.direction === "pull" && "Pull Vercel value into DB"}
              {confirm?.direction === "note" && "Mark drift as intentional"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.direction === "push" && (
                <>
                  This will write the DB value to the Vercel project env. A
                  redeploy is required for the change to take effect.
                </>
              )}
              {confirm?.direction === "pull" && (
                <>
                  This will overwrite the SystemConfig value with the value
                  currently set in Vercel. The change is audited.
                </>
              )}
              {confirm?.direction === "note" && (
                <>
                  No change is written. The drift row is closed with your
                  note for the audit trail.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {confirm && (
            <div className="space-y-2 text-sm">
              <div className="rounded border bg-slate-50 p-2 font-mono text-xs">
                <div>
                  <span className="text-slate-500">key: </span>
                  {confirm.row.configKey}
                </div>
                <div>
                  <span className="text-slate-500">env: </span>
                  {confirm.row.environment}
                </div>
                <div>
                  <span className="text-slate-500">db: </span>
                  {confirm.row.dbValue ?? "(unset)"}
                </div>
                <div>
                  <span className="text-slate-500">vercel: </span>
                  {confirm.row.vercelValue ?? "(unset)"}
                </div>
              </div>
              <label className="text-xs font-medium text-slate-700">
                Reason {confirm.direction === "note" ? "(required)" : "(optional)"}
              </label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  confirm.direction === "note"
                    ? "Why is this drift intentional?"
                    : "Optional note for the audit log"
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(null);
                setReason("");
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={onResolve}
              disabled={
                submitting ||
                (confirm?.direction === "note" && reason.trim().length === 0)
              }
            >
              {submitting && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
