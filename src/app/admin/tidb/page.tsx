"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Database, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DiagnosisCandidate = {
  key: string;
  isSet: boolean;
  scheme: string;
  host: string | null;
};

type ConnectionProbe = {
  resolvedSource: string;
  userinfoNormalizationChanged: boolean;
  host: string | null;
  port: string | null;
  database: string;
  user: string;
  password: {
    present: boolean;
    length: number;
    looksLikeJwt: boolean;
    hasPercentEncoding: boolean;
    hasUnencodedEquals: boolean;
  };
  queryKeys: string[];
  checks: string[];
};

type ConnectionExperiment = {
  label: string;
  ok: boolean;
  error?: string;
  postgresCode?: string;
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
  connectionProbe?: ConnectionProbe | null;
  connectionExperiments?: ConnectionExperiment[];
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
  const [connectionProbe, setConnectionProbe] = useState<ConnectionProbe | null>(null);
  const [connectionExperiments, setConnectionExperiments] = useState<ConnectionExperiment[] | null>(
    null,
  );

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    setDiagnosis(null);
    setConnectionProbe(null);
    setConnectionExperiments(null);
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
            "Not signed in for this request. Refresh after signing in with Google.",
          );
        } else if (res.status === 403) {
          setError("Your account must have the ADMIN role to use HiClaw DB tools.");
        } else {
          setError(data.error || res.statusText);
          if (data.hint) setHint(data.hint);
          if (data.diagnosis) setDiagnosis(data.diagnosis);
          if (data.connectionProbe !== undefined) {
            setConnectionProbe(data.connectionProbe ?? null);
          }
          if (data.connectionExperiments) {
            setConnectionExperiments(data.connectionExperiments);
          }
        }
        return;
      }
      setHealth(data);
      if (data.diagnosis) setDiagnosis(data.diagnosis);
      if (data.connectionProbe !== undefined) {
        setConnectionProbe(data.connectionProbe ?? null);
      }
      setConnectionExperiments(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      void fetchHealth();
    }
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
      const data = (await res.json()) as {
        error?: string;
        hint?: string;
        results?: string[];
        diagnosis?: HealthResponse["diagnosis"];
      };
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
            HiClaw Session DB
          </CardTitle>
          <CardDescription>
            Test the connection and apply HiClaw tables from this deployment. The app uses
            <code className="mx-1 rounded bg-slate-100 px-1">HICLAW_POSTGRES_URL</code>
            first and otherwise falls back to
            <code className="mx-1 rounded bg-slate-100 px-1">DATABASE_URL</code>
            so the marketplace and HiClaw can share the same Supabase Postgres instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void fetchHealth()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test connection"}
            </Button>
            <Button onClick={() => void applySchema()} disabled={applyLoading}>
              {applyLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Apply HiClaw schema
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {hint && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">What to do</p>
              <p className="mt-1 whitespace-pre-wrap">{hint}</p>
            </div>
          )}

          {connectionProbe && !connectionProbe.password.present && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">
              <p className="font-medium">Missing password in URL</p>
              <p className="mt-1 text-xs leading-relaxed">
                The winning PostgreSQL URL is missing the
                <code className="mx-1 rounded bg-red-100 px-1">:password@</code>
                segment. Save a full DSN from Supabase or your Postgres provider, then redeploy.
              </p>
            </div>
          )}

          {connectionProbe && (
            <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">Systematic debug (safe, no password)</p>
              <p className="mt-1 text-xs text-slate-600">
                Parsed from the winning environment variable so you can verify host, role, and URL
                shape without exposing secrets.
              </p>
              <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                <dt className="text-slate-500">Winner</dt>
                <dd className="font-mono">{connectionProbe.resolvedSource}</dd>
                <dt className="text-slate-500">Host / port</dt>
                <dd className="font-mono">
                  {connectionProbe.host ?? "—"}
                  {connectionProbe.port ? `:${connectionProbe.port}` : ""}
                </dd>
                <dt className="text-slate-500">Database</dt>
                <dd className="font-mono">{connectionProbe.database}</dd>
                <dt className="text-slate-500">User (role)</dt>
                <dd className="font-mono">{connectionProbe.user}</dd>
                <dt className="text-slate-500">Password segment</dt>
                <dd className="font-mono">
                  {connectionProbe.password.present
                    ? `present, length ${connectionProbe.password.length}`
                    : "missing"}
                  {connectionProbe.password.looksLikeJwt ? " · token-like" : ""}
                  {connectionProbe.password.hasPercentEncoding ? " · %encoded" : ""}
                  {connectionProbe.password.hasUnencodedEquals ? " · raw =" : ""}
                </dd>
                <dt className="text-slate-500">Userinfo normalized?</dt>
                <dd>{connectionProbe.userinfoNormalizationChanged ? "yes" : "no"}</dd>
                <dt className="text-slate-500">URL query keys</dt>
                <dd className="font-mono">
                  {connectionProbe.queryKeys.length > 0
                    ? connectionProbe.queryKeys.join(", ")
                    : "—"}
                </dd>
              </dl>

              {connectionProbe.checks.length > 0 && (
                <ul className="mt-3 list-inside list-disc text-xs text-slate-700">
                  {connectionProbe.checks.map((check, index) => (
                    <li key={index}>{check}</li>
                  ))}
                </ul>
              )}

              {connectionExperiments && connectionExperiments.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-xs font-medium text-slate-800">Connect experiments</p>
                  <table className="mt-2 w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1 pr-2 font-medium">Variant</th>
                        <th className="py-1 pr-2 font-medium">Result</th>
                        <th className="py-1 font-medium">Postgres code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connectionExperiments.map((row, index) => (
                        <tr key={index} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2 align-top">{row.label}</td>
                          <td className="py-1.5 pr-2 align-top">
                            {row.ok ? (
                              <span className="text-green-700">OK</span>
                            ) : (
                              <span className="text-red-800">{row.error ?? "failed"}</span>
                            )}
                          </td>
                          <td className="py-1.5 align-top font-mono text-slate-600">
                            {row.postgresCode ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {diagnosis?.candidates && diagnosis.candidates.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-800">Env resolution</p>
              <p className="mt-1 text-slate-600">
                The app uses the first row with scheme
                <code className="mx-1 rounded bg-slate-100 px-1">postgres</code>.
              </p>
              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1 pr-2 font-medium">Variable</th>
                    <th className="py-1 pr-2 font-medium">Set</th>
                    <th className="py-1 pr-2 font-medium">Scheme</th>
                    <th className="py-1 font-medium">Host</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnosis.candidates.map((candidate) => (
                    <tr key={candidate.key} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-mono">{candidate.key}</td>
                      <td className="py-1.5 pr-2">{candidate.isSet ? "yes" : "no"}</td>
                      <td className="py-1.5 pr-2">{candidate.scheme}</td>
                      <td className="py-1.5 font-mono text-slate-600">
                        {candidate.host ?? "—"}
                      </td>
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
              {applyResults.map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
