"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowLeft, Database, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface HealthResponse {
  ok: boolean;
  message?: string;
  error?: string;
  hiclawTablesFound?: string[];
  expectedTables?: string[];
}

export default function AdminTidbPage() {
  const { status } = useSession();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResults, setApplyResults] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tidb", {
        method: "GET",
        credentials: "include",
      });
      const data = (await res.json()) as HealthResponse & { error?: string };
      if (!res.ok) {
        setHealth(null);
        if (res.status === 401) {
          setError(
            "Not signed in for this request. Try refreshing the page after signing in with Google."
          );
        } else if (res.status === 403) {
          setError("Your account must have the ADMIN role to use HiClaw DB tools.");
        } else {
          setError(data.error || res.statusText);
        }
        return;
      }
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchHealth();
  }, [status, fetchHealth]);

  const applySchema = async () => {
    setApplyLoading(true);
    setApplyResults(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/tidb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "apply_hiclaw_schema" }),
      });
      const data = await res.json();
      if (data.results) setApplyResults(data.results);
      if (!res.ok) setError(data.error || res.statusText);
      await fetchHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyLoading(false);
    }
  };

  if (status === "loading") {
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
    <div className="mx-auto max-w-2xl space-y-6 p-6">
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
            <Database className="h-5 w-5" />
            HiClaw session DB (Postgres)
          </CardTitle>
          <CardDescription>
            Test the connection and apply HiClaw tables from the deployed app. Set{" "}
            <code className="rounded bg-slate-100 px-1">HICLAW_POSTGRES_URL</code> or{" "}
            <code className="rounded bg-slate-100 px-1">DB9_DATABASE_URL</code> (or a postgres{" "}
            <code className="rounded bg-slate-100 px-1">TIDB_DATABASE_URL</code> legacy name) on Vercel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchHealth} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test connection"}
            </Button>
            <Button onClick={applySchema} disabled={applyLoading}>
              {applyLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Apply HiClaw schema
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          )}

          {health && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-medium">
                {health.ok ? "HiClaw DB connection OK" : "HiClaw DB connection failed"}
              </p>
              {health.message && <p className="mt-1 text-slate-600">{health.message}</p>}
              {health.hiclawTablesFound && (
                <p className="mt-2">
                  <span className="text-slate-500">HiClaw tables: </span>
                  {health.hiclawTablesFound.length > 0
                    ? health.hiclawTablesFound.join(", ")
                    : "none yet — run Apply HiClaw schema"}
                </p>
              )}
            </div>
          )}

          {applyResults && (
            <div className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-white p-3 font-mono text-xs">
              {applyResults.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
