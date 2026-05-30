"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { ApiState, DraftState, Environment } from "./shared-types";
import { ExportImportSection } from "./export-import";

interface RegionsTabProps {
  data: ApiState;
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  environment: Environment;
  onImported: () => void;
}

export function RegionsTab({
  data,
  draft,
  setDraft,
  environment,
  onImported,
}: RegionsTabProps) {
  return (
    <div className="space-y-4">
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

      <ExportImportSection environment={environment} onImported={onImported} />
    </div>
  );
}
