"use client";

import { Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { ApiState } from "./shared-types";

export function DatabaseTab({ data }: { data: ApiState }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Database
          </CardTitle>
          <CardDescription>
            Read-only. DB cutover requires manual coordination — see
            docs/RUNBOOK.md (postgres-cutover-runbook).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-slate-500">Provider: </span>
            <Badge variant="outline">{data.db.provider}</Badge>
          </div>
          <div>
            <span className="text-slate-500">Host: </span>
            <span className="font-mono text-xs">
              {data.db.host ?? "(unknown)"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
