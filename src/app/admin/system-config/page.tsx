"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Cloud, Database, HardDrive, Loader2, RefreshCw, Save } from "lucide-react";

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

type StorageProviderName = "vercel" | "gcs" | "tencent-cos" | "db";

type ConfigStatus = {
  STORAGE_PROVIDER: StorageProviderName;
  isConfigured: boolean;
  error?: string;
};

export default function AdminCloudConfigPage() {
  const { status } = useSession();
  const [data, setData] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedStorage, setSelectedStorage] = useState<StorageProviderName>("db");

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/system-config", { credentials: "include" });
      const body = (await res.json()) as ConfigStatus;
      setData(body);
      setSelectedStorage(body.STORAGE_PROVIDER);
    } catch (error) {
      setData({
        STORAGE_PROVIDER: "db",
        isConfigured: false,
        error: error instanceof Error ? error.message : "Failed to load config",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status]);

  async function saveConfig() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          STORAGE_PROVIDER: selectedStorage,
        }),
      });
      if (!res.ok) throw new Error("Failed to update configuration");
      setMessage("Cloud configuration updated successfully.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update configuration");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
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
            <Cloud className="h-5 w-5" />
            Cloud & Infra Control
          </CardTitle>
          <CardDescription>
            Manage the underlying cloud stack and storage providers. 
            Switch between Vercel-native and Google Cloud-native infrastructure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {data?.error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {data.error}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <HardDrive className="h-4 w-4" />
              Storage Configuration
            </div>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Storage Provider</label>
                <Select
                  value={selectedStorage}
                  onValueChange={(value) => setSelectedStorage(value as StorageProviderName)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="db">Database (Data URLs - Legacy)</SelectItem>
                    <SelectItem value="vercel">Vercel Blob</SelectItem>
                    <SelectItem value="gcs">Google Cloud Storage</SelectItem>
                    <SelectItem value="tencent-cos">Tencent COS (China)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Controls where profile audio and generated images are stored.
                </p>
              </div>

              <div className="flex flex-col justify-end space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={data?.STORAGE_PROVIDER === selectedStorage ? "default" : "outline"}>
                    {selectedStorage === "db" ? "Local-first" : "Cloud Storage"}
                  </Badge>
                  {data?.isConfigured ? (
                    <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">
                      Configured
                    </Badge>
                  ) : selectedStorage !== "db" && (
                    <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">
                      Missing Env
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 border border-slate-100">
              <div className="flex items-start gap-3">
                <Database className="h-4 w-4 mt-0.5 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">Provider Details</p>
                  {selectedStorage === "db" && (
                    <p className="mt-1">Files are converted to Base64 and stored directly in the expert table. No external setup required, but increases DB size.</p>
                  )}
                  {selectedStorage === "vercel" && (
                    <p className="mt-1">Uses <code>@vercel/blob</code>. Requires <code>BLOB_READ_WRITE_TOKEN</code> to be set.</p>
                  )}
                  {selectedStorage === "gcs" && (
                    <p className="mt-1">Uses Google Cloud Storage. Requires <code>GCS_BUCKET_NAME</code> and <code>GOOGLE_CLOUD_PROJECT</code> / Service Account.</p>
                  )}
                  {selectedStorage === "tencent-cos" && (
                    <p className="mt-1">Uses Tencent COS for China-local low-latency storage. Requires <code>TENCENT_COS_SECRET_ID</code>, <code>TENCENT_COS_SECRET_KEY</code>, <code>TENCENT_COS_BUCKET</code>, and <code>TENCENT_COS_REGION</code>.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {message && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => void load()} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
