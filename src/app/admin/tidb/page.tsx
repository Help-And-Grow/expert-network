"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowLeft, Database, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DiagnosisCandidate = {
  key: string;
  isSet: boolean;
  scheme: string;
  host: string | null;
};

interface HealthResponse {
  ok: boolean;
  message?: string;
  error?: string;
  hint?: string;
  hiclawTablesFound?: string[];
  expectedTables?: string[];
  diagnosis?: {
    resolvedSource?: string;
    winningSource?: string | null;
    candidates?: DiagnosisCandidate[];
  };
}

export default function AdminTidbPage() {
  const { status } = useSession();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResults, setApplyResults] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<HealthResponse["diagnosis"] | null>(null);

  const [db9ApiKey, setDb9ApiKey] = useState("");
  const [db9DbName, setDb9DbName] = useState("expert-network-hiclaw");
  const [db9Busy, setDb9Busy] = useState(false);
  const [db9Error, setDb9Error] = useState<string | null>(null);
  const [db9Reminder, setDb9Reminder] = useState<string | null>(null);
  const [db9ConnectionString, setDb9ConnectionString] = useState<string | null>(null);

  const callDb9Proxy = async (action: "get_connection_string" | "reset_admin_password") => {
    setDb9Busy(true);
    setDb9Error(null);
    setDb9Reminder(null);
    setDb9ConnectionString(null);
    try {
      const res = await fetch("/api/admin/tidb/db9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          apiKey: db9ApiKey.trim(),
          databaseName: db9DbName.trim() || "expert-network-hiclaw",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string | Record<string, string[]>;
        connectionString?: string;
        reminder?: string;
      };
      if (!res.ok || !data.ok) {
        const err =
          typeof data.error === "string"
            ? data.error
            : data.error
              ? JSON.stringify(data.error)
              : res.statusText;
        setDb9Error(err);
        return;
      }
      if (data.connectionString) setDb9ConnectionString(data.connectionString);
      if (data.reminder) setDb9Reminder(data.reminder);
    } catch (e) {
      setDb9Error(e instanceof Error ? e.message : String(e));
    } finally {
      setDb9Busy(false);
    }
  };

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    setDiagnosis(null);
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
          if (data.hint) setHint(data.hint);
          if (data.diagnosis) setDiagnosis(data.diagnosis);
        }
        return;
      }
      setHealth(data);
      if (data.diagnosis) setDiagnosis(data.diagnosis);
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
    setHint(null);
    try {
      const res = await fetch("/api/admin/tidb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "apply_hiclaw_schema" }),
      });
      const data = await res.json();
      if (data.results) setApplyResults(data.results);
      if (!res.ok) {
        setError(data.error || res.statusText);
        if (data.hint) setHint(data.hint);
        if (data.diagnosis) setDiagnosis(data.diagnosis);
      }
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
            <Database className="h-5 w-5" />
            HiClaw session DB (Postgres)
          </CardTitle>
          <CardDescription>
            Test the connection and apply HiClaw tables from this deployment. The server uses the first{" "}
            <strong>valid PostgreSQL</strong> URL in order:{" "}
            <code className="rounded bg-slate-100 px-1">DB9_DATABASE_URL</code> →{" "}
            <code className="rounded bg-slate-100 px-1">HICLAW_POSTGRES_URL</code> →{" "}
            <code className="rounded bg-slate-100 px-1">TIDB_DATABASE_URL</code>. Legacy{" "}
            <code className="rounded bg-slate-100 px-1">mysql://</code> values are skipped so DB9 can win.
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

          {hint && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">What to do</p>
              <p className="mt-1 whitespace-pre-wrap">{hint}</p>
            </div>
          )}

          {diagnosis?.candidates && diagnosis.candidates.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-800">Env resolution (no secrets)</p>
              <p className="mt-1 text-slate-600">
                The app uses the first row with scheme{" "}
                <code className="rounded bg-slate-100 px-1">postgres</code>. Values starting with{" "}
                <code className="rounded bg-slate-100 px-1">mysql://</code> are ignored when choosing a URL.
                If nothing is postgres, fix or remove the blocking variable (including Vercel{" "}
                <strong>Team</strong> env).
              </p>
              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1 pr-2 font-medium">Variable</th>
                    <th className="py-1 pr-2 font-medium">Set</th>
                    <th className="py-1 pr-2 font-medium">Scheme</th>
                    <th className="py-1 font-medium">Host (only)</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnosis.candidates.map((c) => (
                    <tr key={c.key} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-mono">{c.key}</td>
                      <td className="py-1.5 pr-2">{c.isSet ? "yes" : "no"}</td>
                      <td className="py-1.5 pr-2">{c.scheme}</td>
                      <td className="py-1.5 font-mono text-slate-600">{c.host ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(diagnosis.resolvedSource || diagnosis.winningSource) && (
                <p className="mt-2 text-slate-600">
                  <span className="font-medium text-slate-800">Winner: </span>
                  <code className="rounded bg-slate-100 px-1">
                    {diagnosis.resolvedSource ?? diagnosis.winningSource}
                  </code>
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-800">If DB9 CLI / db9 login fails on your laptop</p>
            <p className="mt-1">
              Corporate TLS proxies often break the <code className="rounded bg-slate-100 px-1">db9</code>{" "}
              binary. Use the <strong>DB9 API helper</strong> below (this server calls{" "}
              <code className="rounded bg-slate-100 px-1">api.db9.ai</code> for you), or set{" "}
              <code className="rounded bg-slate-100 px-1">DB9_DATABASE_URL</code> on Vercel manually.
            </p>
          </div>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">DB9 API helper (no local CLI)</CardTitle>
          <CardDescription>
            Paste a DB9 <strong>Bearer token</strong> from <code className="rounded bg-slate-100 px-1">db9 token show</code>{" "}
            (after <code className="rounded bg-slate-100 px-1">db9 login</code> on any machine). This app calls{" "}
            <code className="rounded bg-slate-100 px-1">https://api.db9.ai</code> once and returns a{" "}
            <code className="rounded bg-slate-100 px-1">postgresql://</code> URL to paste into Vercel. The token
            is not stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="db9-api-key" className="text-sm font-medium text-slate-800">
              DB9 API token
            </label>
            <Input
              id="db9-api-key"
              type="password"
              autoComplete="off"
              placeholder="Bearer token from db9 token show"
              value={db9ApiKey}
              onChange={(e) => setDb9ApiKey(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="db9-db-name" className="text-sm font-medium text-slate-800">
              Database name
            </label>
            <Input
              id="db9-db-name"
              type="text"
              autoComplete="off"
              placeholder="expert-network-hiclaw"
              value={db9DbName}
              onChange={(e) => setDb9DbName(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={db9Busy || !db9ApiKey.trim()}
              onClick={() => void callDb9Proxy("get_connection_string")}
            >
              {db9Busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch connection string"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={db9Busy || !db9ApiKey.trim()}
              onClick={() => void callDb9Proxy("reset_admin_password")}
            >
              Reset DB9 admin password &amp; fetch URL
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            <strong>Reset</strong> issues a new Postgres password on DB9 (use if “password authentication
            failed”). If DB9 returns 410, your org may be passwordless — use the official CLI{" "}
            <code className="rounded bg-slate-100 px-1">db9 db connect</code> instead.
          </p>

          {db9Error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{db9Error}</div>
          )}
          {db9Reminder && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {db9Reminder}
            </div>
          )}
          {db9ConnectionString && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-800">Connection string</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(db9ConnectionString);
                  }}
                >
                  Copy
                </Button>
              </div>
              <textarea
                readOnly
                className="h-24 w-full rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-xs"
                value={db9ConnectionString}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
