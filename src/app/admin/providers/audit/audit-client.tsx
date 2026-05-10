"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const CATEGORIES = ["", "llm", "storage", "registry", "system-config"] as const;
const ENVIRONMENTS = ["", "production", "preview", "development"] as const;

export default function AuditClient() {
  const { status } = useSession();
  const searchParams = useSearchParams();

  const [category, setCategory] = useState<string>(
    searchParams?.get("category") ?? "",
  );
  const [environment, setEnvironment] = useState<string>(
    searchParams?.get("environment") ?? "",
  );
  const [actorEmail, setActorEmail] = useState<string>(
    searchParams?.get("actorEmail") ?? "",
  );
  const [since, setSince] = useState<string>(
    searchParams?.get("since") ?? "",
  );
  const [until, setUntil] = useState<string>(
    searchParams?.get("until") ?? "",
  );

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buildQs = useCallback(
    (extraCursor?: string | null) => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (environment) params.set("environment", environment);
      if (actorEmail) params.set("actorEmail", actorEmail);
      if (since) params.set("since", new Date(since).toISOString());
      if (until) params.set("until", new Date(until).toISOString());
      params.set("limit", "50");
      if (extraCursor) params.set("cursor", extraCursor);
      return params.toString();
    },
    [category, environment, actorEmail, since, until],
  );

  const load = useCallback(
    async (mode: "reset" | "more") => {
      setLoading(true);
      setErr(null);
      try {
        const qs = buildQs(mode === "more" ? cursor : null);
        const res = await fetch(`/api/admin/providers/audit?${qs}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setRows((prev) =>
          mode === "more" ? [...prev, ...(json.rows ?? [])] : json.rows ?? [],
        );
        setCursor(json.nextCursor ?? null);
        setHasMore(!!json.hasMore);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "load failed");
      } finally {
        setLoading(false);
      }
    },
    [buildQs, cursor],
  );

  useEffect(() => {
    if (status === "authenticated") void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") {
    return (
      <div className="p-6 text-sm">
        <Link href="/" className="text-blue-600">
          Sign in required
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/admin/providers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Providers
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Provider audit log</h1>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
        <Select value={category || "_all"} onValueChange={(v) => setCategory(v === "_all" ? "" : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All categories</SelectItem>
            {CATEGORIES.filter(Boolean).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={environment || "_all"}
          onValueChange={(v) => setEnvironment(v === "_all" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All envs</SelectItem>
            {ENVIRONMENTS.filter(Boolean).map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="actor email"
          value={actorEmail}
          onChange={(e) => setActorEmail(e.target.value)}
        />
        <Input
          type="datetime-local"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          placeholder="since"
        />
        <Input
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          placeholder="until"
        />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" onClick={() => load("reset")} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Apply filters
        </Button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs">
            <tr>
              <th className="p-2">When</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Env</th>
              <th className="p-2">Category</th>
              <th className="p-2">Key</th>
              <th className="p-2">Before → After</th>
              <th className="p-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="whitespace-nowrap p-2 text-xs">
                  {new Date(r.changedAt).toLocaleString()}
                </td>
                <td className="p-2 text-xs">
                  {r.actorEmail ?? (
                    <Badge variant="outline">{r.actorRole ?? "system"}</Badge>
                  )}
                </td>
                <td className="p-2">
                  <Badge variant="outline">{r.environment}</Badge>
                </td>
                <td className="p-2">
                  <Badge variant="outline">{r.category}</Badge>
                </td>
                <td className="p-2 font-mono text-[11px]">{r.configKey}</td>
                <td className="p-2 font-mono text-[11px]">
                  <span className="text-red-700 line-through">
                    {summarize(r.before)}
                  </span>{" "}
                  →{" "}
                  <span className="text-emerald-700">{summarize(r.after)}</span>
                </td>
                <td className="p-2 text-xs italic text-slate-600">
                  {r.reason ?? ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={7}
                  className="p-4 text-center text-xs italic text-slate-500"
                >
                  No matching changes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load("more")}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function summarize(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return String(v);
  }
}
