"use client";

import { HardDrive, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ApiState, DraftState, Environment } from "./shared-types";
import { ProbeButton } from "./shared-components";
import { RecentChangesPanel } from "./shared-components";

interface StorageTabProps {
  data: ApiState;
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  environment: Environment;
  onShowAddStorage: () => void;
}

export function StorageTab({
  data,
  draft,
  setDraft,
  environment,
  onShowAddStorage,
}: StorageTabProps) {
  return (
    <div className="space-y-4">
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
            onValueChange={(v) => setDraft({ ...draft, activeStorage: v })}
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
        <Button size="sm" variant="outline" onClick={onShowAddStorage}>
          <Plus className="mr-1 h-4 w-4" /> Add storage provider
        </Button>
      </div>

      {data.storage.map((row) => (
        <Card key={row.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {row.displayName}{" "}
                <span className="ml-1 font-mono text-xs text-slate-500">
                  {row.key}
                </span>
              </CardTitle>
              <ProbeButton
                category="storage"
                providerKey={row.key}
                environment={environment}
              />
            </div>
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
                  variant="outline"
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

      <RecentChangesPanel category="storage" environment={environment} />
    </div>
  );
}
