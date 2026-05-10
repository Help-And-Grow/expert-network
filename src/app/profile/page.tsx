"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

import {
  Loader2,
  Upload,
  FileText,
  FileDown,
  X,
  ImageIcon,
  Sparkles,
  ArrowLeft,
  Trash2,
  ExternalLink,
  Pencil,
  Check,
  Volume2,
  DollarSign,
  Send,
  Clock,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Globe2,
} from "lucide-react";

import { AudioPlayer } from "@/components/audio-player";
import {
  CountryFlagList,
  CountryMultiSelect,
} from "@/components/country-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserMenu } from "@/components/user-menu";
import { WeeklyScheduleEditor, type WeeklySchedule } from "@/components/weekly-schedule-editor";
import { useAuth } from "@/hooks/use-auth";

import { getTelegramInitData } from "@/lib/telegram";

interface ExpertProfile {
  id: string;
  bio: string | null;
  avatarScript: string | null;
  hasAvatar: boolean;
  hasAudio: boolean;
  hasVoiceClone: boolean;
  gender: string | null;
  tonWalletAddress: string | null;
  tonWalletType: string | null;
  priceOnlineCents: number | null;
  priceOfflineCents: number | null;
  currency: string;
  sessionType: string;
  documentName: string | null;
  weeklySchedule: WeeklySchedule | null;
  stripeAccountId: string | null;
  stripeAccountStatus: string | null;
  isPublished: boolean;
  countries: string[];
  user: {
    id: string;
    name: string | null;
    nickName: string | null;
    email: string | null;
    image: string | null;
    telegramUsername: string | null;
  };
}

export default function ProfilePage() {
  const { status: sessionStatus, isTelegram, user: authUser } = useAuth();
  const router = useRouter();
  const telegramInitData = getTelegramInitData();

  const [profile, setProfile] = useState<ExpertProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionMsg, setSectionMsg] = useState<{ text: string; section: string; isError: boolean } | null>(null);

  const [bio, setBio] = useState("");
  const [introScript, setIntroScript] = useState("");

  const [editingIntro, setEditingIntro] = useState(false);
  const [savingIntro, setSavingIntro] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [improvingIntro, setImprovingIntro] = useState(false);
  const toastRef = useRef<HTMLParagraphElement>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [avatarCacheBuster, setAvatarCacheBuster] = useState("");
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioCacheBuster, setAudioCacheBuster] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nickNameOverride, setNickNameOverride] = useState<string | null>(null);
  const [editingGender, setEditingGender] = useState(false);
  const [editingTelegram, setEditingTelegram] = useState(false);
  const [tgUsername, setTgUsername] = useState("");
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [editingPricing, setEditingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [pOnline, setPOnline] = useState("");
  const [pOffline, setPOffline] = useState("");
  const [stripeKycLoading, setStripeKycLoading] = useState(false);
  const [editingCountries, setEditingCountries] = useState(false);
  const [savingCountries, setSavingCountries] = useState(false);
  const [countriesDraft, setCountriesDraft] = useState<string[]>([]);

  const fetchProfile = useCallback(async () => {
    try {
      const headers = telegramInitData
        ? { "x-telegram-init-data": telegramInitData }
        : undefined;
      const fetchProfileApi = () => fetch("/api/expert/profile", { headers });
      let res = await fetchProfileApi();
      if (res.status === 401 && telegramInitData) {
        await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: telegramInitData }),
        }).catch(() => {});
        res = await fetchProfileApi();
      }
      if (res.status === 404) {
        setProfile(null);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data: ExpertProfile = await res.json();
      setProfile(data);
      if (data.hasAudio) {
        setAudioCacheBuster(`?full=1&t=${Date.now()}`);
      }
      setBio(data.bio || "");
      setIntroScript(data.avatarScript ?? "");
      setUploadedFileName(data.documentName ?? null);
      setPOnline(data.priceOnlineCents != null ? String(data.priceOnlineCents / 100) : "");
      setPOffline(data.priceOfflineCents != null ? String(data.priceOfflineCents / 100) : "");
      setTgUsername(data.user?.telegramUsername ?? "");
      setCountriesDraft(Array.isArray(data.countries) ? data.countries : []);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [telegramInitData]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (isTelegram) {
      fetchProfile();
      return;
    }
    if (sessionStatus === "authenticated") {
      fetchProfile();
    } else if (sessionStatus === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [sessionStatus, isTelegram, fetchProfile, router]);

  const showMessage = (msg: string, section: string, isError = false, duration = 3000) => {
    setSectionMsg({ text: msg, section, isError });
    setTimeout(() => setSectionMsg((prev) => (prev?.text === msg ? null : prev)), duration);
    requestAnimationFrame(() => {
      toastRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const saveSection = async (data: Record<string, unknown>) => {
    const res = await fetch("/api/expert/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? "Failed to save");
    }
    return res.json();
  };

  const postExpertImprove = useCallback(
    async (payload: { type: "intro"; content: unknown }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
      };
      const request = () =>
        fetch("/api/expert/improve", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(payload),
        });
      let res = await request();
      if (res.status === 401 && telegramInitData) {
        await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: telegramInitData }),
        }).catch(() => {});
        res = await request();
      }
      return res;
    },
    [telegramInitData],
  );

  const handleSaveIntro = async () => {
    setSavingIntro(true);
    try {
      await saveSection({ avatarScript: introScript, bio });
      setProfile((prev) =>
        prev ? { ...prev, avatarScript: introScript, bio } : prev,
      );
      setEditingIntro(false);
      showMessage("Introduction saved!", "intro");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Save failed", "intro", true, 5000);
    } finally {
      setSavingIntro(false);
    }
  };

  const handleCancelIntro = () => {
    setIntroScript(profile?.avatarScript ?? "");
    setBio(profile?.bio ?? "");
    setEditingIntro(false);
  };

  const handleImproveIntro = async () => {
    if (!introScript.trim()) return;
    setImprovingIntro(true);
    try {
      const res = await postExpertImprove({ type: "intro", content: introScript });
      const data = await res.json();
      if (!res.ok) {
        const parts = [data.error, data.detail].filter(
          (s: unknown) => typeof s === "string" && (s as string).trim(),
        ) as string[];
        throw new Error(parts.join(" — "));
      }
      setIntroScript(data.improved);
      showMessage("Introduction improved by AI!", "intro");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "AI improvement failed", "intro", true, 5000);
    } finally {
      setImprovingIntro(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      showMessage("File too large. Maximum 4MB.", "document", true, 5000);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/onboarding/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const raw = await res.text();
      let data: { error?: string; success?: boolean } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        // Non-JSON response (e.g. Vercel's 413 "Request Entity Too Large" HTML page).
        if (!res.ok) throw new Error(`Upload failed (status ${res.status})`);
      }
      if (!res.ok) throw new Error(data.error ?? `Upload failed (status ${res.status})`);
      setUploadedFileName(file.name);
      showMessage("Document uploaded!", "document");
      fetchProfile();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Upload failed", "document", true, 5000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await fetch("/api/onboarding/publish", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to publish");
      }
      setProfile((prev) => (prev ? { ...prev, isPublished: true } : prev));
      showMessage("Profile published! It's now visible in the community.", "publish");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Publish failed", "publish", true, 5000);
    } finally {
      setPublishing(false);
    }
  };

  const handleGenerateImage = async () => {
    const hadAvatar = !!profile?.hasAvatar;
    setRegenerating(true);
    try {
      const res = await fetch("/api/expert/regenerate-image", {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; detail?: string };
        const hint = data.detail ? `${data.error ?? "Failed"} — ${data.detail}` : data.error;
        throw new Error(hint ?? "Failed to generate image");
      }
      const data = await res.json();
      setProfile((prev) =>
        prev ? { ...prev, hasAvatar: !!data.profileImage } : prev
      );
      setAvatarCacheBuster(`?t=${Date.now()}`);
      showMessage(
        hadAvatar ? "Profile image regenerated!" : "Profile image generated!",
        "image",
      );
    } catch (err) {
      showMessage(
        err instanceof Error ? err.message : "Failed to generate image",
        "image",
        true,
        5000
      );
    } finally {
      setRegenerating(false);
    }
  };

  const handleGenerateAudio = async () => {
    const hadAudio = !!profile?.hasAudio;
    setGeneratingAudio(true);
    try {
      const res = await fetch("/api/expert/generate-audio", {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; detail?: string };
        const hint = data.detail ? `${data.error ?? "Failed"} — ${data.detail}` : data.error;
        throw new Error(hint ?? "Failed to generate audio");
      }
      setProfile((prev) => (prev ? { ...prev, hasAudio: true } : prev));
      setAudioCacheBuster(`?full=1&t=${Date.now()}`);
      showMessage(
        hadAudio ? "Voice introduction regenerated!" : "Voice introduction generated!",
        "voice",
      );
    } catch (err) {
      showMessage(
        err instanceof Error ? err.message : "Failed to generate audio",
        "voice",
        true,
        5000
      );
    } finally {
      setGeneratingAudio(false);
    }
  };

  const handleGenderChange = async (gender: string) => {
    setProfile((prev) => (prev ? { ...prev, gender } : prev));
    setEditingGender(false);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender }),
      });
      showMessage("Gender updated.", "voice");
    } catch {
      showMessage("Failed to save gender", "voice", true, 5000);
    }
  };

  const handleSavePricing = async () => {
    setSavingPricing(true);
    try {
      const onlineCents = pOnline ? Math.round(parseFloat(pOnline) * 100) : null;
      const offlineCents = pOffline ? Math.round(parseFloat(pOffline) * 100) : null;
      const data: Record<string, number | null> = {};
      data.priceOnlineCents = onlineCents;
      data.priceOfflineCents = offlineCents;
      await saveSection(data);
      setProfile((prev) =>
        prev ? { ...prev, priceOnlineCents: onlineCents, priceOfflineCents: offlineCents } : prev
      );
      setEditingPricing(false);
      showMessage("Pricing saved!", "pricing");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Save failed", "pricing", true, 5000);
    } finally {
      setSavingPricing(false);
    }
  };

  const handleSaveCountries = async () => {
    setSavingCountries(true);
    try {
      await saveSection({ countries: countriesDraft });
      setProfile((prev) =>
        prev ? { ...prev, countries: countriesDraft } : prev,
      );
      setEditingCountries(false);
      showMessage("Countries saved!", "countries");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Save failed", "countries", true, 5000);
    } finally {
      setSavingCountries(false);
    }
  };

  const handleCancelCountries = () => {
    setCountriesDraft(profile?.countries ?? []);
    setEditingCountries(false);
  };

  const handleCancelPricing = () => {
    setPOnline(profile?.priceOnlineCents != null ? String(profile.priceOnlineCents / 100) : "");
    setPOffline(profile?.priceOfflineCents != null ? String(profile.priceOfflineCents / 100) : "");
    setEditingPricing(false);
  };

  const handleSaveName = async () => {
    const trimmed = editNameValue.trim();
    if (!trimmed) {
      showMessage("Name cannot be empty.", "name", true, 3000);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
        },
        body: JSON.stringify({ nickName: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setProfile((prev) =>
        prev ? { ...prev, user: { ...prev.user, nickName: trimmed } } : prev
      );
      setNickNameOverride(trimmed);
      setEditingName(false);
      showMessage("Name updated!", "name");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Save failed", "name", true, 5000);
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveTelegram = async () => {
    const cleaned = tgUsername.replace(/^@/, "").trim();
    if (cleaned && !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(cleaned)) {
      showMessage(
        "Invalid username. Must be 5–32 characters, start with a letter, and contain only letters, numbers, or underscores.",
        "telegram",
        true,
        5000
      );
      return;
    }
    setSavingTelegram(true);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
              },
        body: JSON.stringify({ telegramUsername: cleaned || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to save");
      }
      setTgUsername(cleaned);
      setProfile((prev) =>
        prev ? { ...prev, user: { ...prev.user, telegramUsername: cleaned || null } } : prev
      );
      setEditingTelegram(false);
      showMessage("Telegram username saved!", "telegram");
      if (cleaned) {
        fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "greeting", telegramUsername: cleaned }),
        }).catch(() => {});
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Save failed", "telegram", true, 5000);
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleStripeKyc = async () => {
    setStripeKycLoading(true);
    try {
      const headers: Record<string, string> = {
        ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
      };
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Failed to create Stripe account");
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      showMessage(
        err instanceof Error ? err.message : "Stripe setup failed",
        "stripe",
        true,
        5000
      );
    } finally {
      setStripeKycLoading(false);
    }
  };

  const refreshStripeStatus = async () => {
    try {
      const headers: Record<string, string> = {
        ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
      };
      const res = await fetch("/api/stripe/connect", { headers });
      if (res.ok) {
        const data = await res.json();
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                stripeAccountStatus: data.status,
                stripeAccountId: prev.stripeAccountId,
              }
            : prev
        );
        if (data.status === "active") {
          showMessage("Stripe account verified! You can now receive payments.", "stripe");
        }
      }
    } catch {
      // silent
    }
  };

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderToast = (section: string) =>
    sectionMsg?.section === section ? (
      <p
        ref={toastRef}
        className={`text-sm text-center rounded-lg px-4 py-2 ${
          sectionMsg.isError
            ? "bg-destructive/10 text-destructive"
            : "bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {sectionMsg.text}
      </p>
    ) : null;

  const handleDeleteAccount = async () => {
    if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) return;
    
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/user", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      
      await signOut({ callbackUrl: "/" });
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to delete account", "account", true, 5000);
      setDeletingAccount(false);
    }
  };

  const isExpert = !!profile;
  const nickName =
    nickNameOverride ??
    profile?.user?.nickName ??
    authUser?.name ??
    "User";
  const email = profile?.user?.email ?? authUser?.email;
  const telegramUsername = profile?.user?.telegramUsername ?? null;

  return (
    <div className="app-shell mx-auto min-h-screen max-w-lg bg-background pb-12">
      <header className="border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  className="h-8 text-lg font-bold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)} className="shrink-0 h-8 w-8 p-0">
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" onClick={handleSaveName} disabled={savingName} className="shrink-0 h-8 w-8 p-0">
                  {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : (
              <h1
                className="text-xl font-bold truncate cursor-pointer group flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
                onClick={() => { setEditNameValue(nickName); setEditingName(true); }}
              >
                {nickName}
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </h1>
            )}
            {renderToast("name")}
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{email}</span>
              {telegramUsername && (
                <span className="shrink-0 text-sky-600 dark:text-sky-400">
                  @{telegramUsername}
                </span>
              )}
              {isExpert && profile.isPublished && (
                <button
                  onClick={() => router.push(`/experts/${profile.id}?from=profile`)}
                  className="shrink-0 flex items-center gap-1 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Public Profile
                </button>
              )}
            </div>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="space-y-6 p-4">
        {isExpert && !profile.isPublished && (
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-4 space-y-3">
              {renderToast("publish")}
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-amber-100 dark:bg-amber-900/50 p-1.5 mt-0.5">
                  <ExternalLink className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Profile not published
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Your profile is only visible to you. Publish it to appear in the community directory and let others book sessions with you.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                className="mt-3 w-full gap-2"
                onClick={handlePublish}
                disabled={publishing}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Publish Profile
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stripe KYC Banner — web only; Telegram Mini App uses TON */}
        {isExpert && !isTelegram && profile.stripeAccountStatus !== "active" && (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="p-4 space-y-3">
              {renderToast("stripe")}
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/50 p-1.5 mt-0.5">
                  {profile.stripeAccountStatus === "restricted" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  ) : profile.stripeAccountStatus === "onboarding" ? (
                    <CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    {profile.stripeAccountStatus === "restricted"
                      ? "Stripe account restricted"
                      : profile.stripeAccountStatus === "onboarding"
                        ? "Complete Stripe verification"
                        : "Set up Stripe to receive payments"}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                    {profile.stripeAccountStatus === "restricted"
                      ? "Your Stripe account has restrictions. Complete the required verification to continue receiving payments."
                      : profile.stripeAccountStatus === "onboarding"
                        ? "You started setting up Stripe but haven't completed the verification. Continue to finish."
                        : "Connect a Stripe account so you can receive session payments directly. This requires a quick identity verification."}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={handleStripeKyc}
                  disabled={stripeKycLoading}
                >
                  {stripeKycLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {profile.stripeAccountStatus === "none" || !profile.stripeAccountStatus
                    ? "Set Up Stripe"
                    : "Continue Verification"}
                </Button>
                {profile.stripeAccountId && profile.stripeAccountStatus === "onboarding" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshStripeStatus}
                    className="gap-1"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Refresh Status
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stripe Connected — web only; Telegram Mini App uses TON */}
        {isExpert && !isTelegram && profile.stripeAccountStatus === "active" && (
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 p-1.5">
                  <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                    Stripe account active
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                    You&apos;re set up to receive payments from meetups.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Countries / Regions */}
        {isExpert && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe2 className="h-4 w-4" />
                  Countries / Regions of expertise
                </CardTitle>
                {!editingCountries ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingCountries(true)}
                    className="gap-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelCountries}
                      className="gap-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveCountries}
                      disabled={savingCountries}
                      className="gap-1"
                    >
                      {savingCountries ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {renderToast("countries")}
              {editingCountries ? (
                <CountryMultiSelect
                  value={countriesDraft}
                  onChange={setCountriesDraft}
                  compact
                />
              ) : profile.countries.length > 0 ? (
                <CountryFlagList codes={profile.countries} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not set — add the countries or regions you have hands-on
                  experience with so players can find you.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Telegram Username */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4" />
                Telegram
              </CardTitle>
              {!editingTelegram ? (
                <Button variant="ghost" size="sm" onClick={() => setEditingTelegram(true)} className="gap-1">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setTgUsername(telegramUsername ?? ""); setEditingTelegram(false); }} className="gap-1">
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveTelegram} disabled={savingTelegram} className="gap-1">
                    {savingTelegram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {renderToast("telegram")}
            {editingTelegram ? (
              <Input
                value={tgUsername}
                onChange={(e) => setTgUsername(e.target.value)}
                placeholder="@username"
                className="max-w-xs"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {telegramUsername ? (
                  <>@{telegramUsername} — You&apos;ll receive meetup notifications via Telegram.</>
                ) : (
                  <>Not set — Add your Telegram username to receive notifications and access the Mini App.</>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {!isExpert ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">
                You don&apos;t have a profile yet. Create one to share your expertise and let others book sessions with you.
              </p>
              <Button onClick={() => router.push("/onboarding")}>
                Complete Onboarding
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Profile Image */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Profile Image
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {renderToast("image")}
                {profile.hasAvatar ? (
                  <div className="aspect-square rounded-xl overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/experts/${profile.id}/avatar${avatarCacheBuster}`}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-square rounded-xl bg-muted flex flex-col items-center justify-center gap-3">
                    <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No profile image yet</p>
                  </div>
                )}
                <Button
                  variant="outline"
                  className="mt-3 w-full gap-2"
                  onClick={handleGenerateImage}
                  disabled={regenerating}
                >
                  {regenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {profile.hasAvatar ? "Regenerate Image" : "Generate Image"}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Voice Introduction */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Volume2 className="h-4 w-4" />
                  Voice Introduction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {renderToast("voice")}
                {/* Gender for default voice */}
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm text-muted-foreground">
                    Default voice:{" "}
                    <span className="font-medium text-foreground">
                      {profile?.gender === "female" ? "Female" : profile?.gender === "male" ? "Male" : "Male (default)"}
                    </span>
                  </span>
                  {editingGender ? (
                    <div className="flex gap-1">
                      {[
                        { value: "male", label: "Male" },
                        { value: "female", label: "Female" },
                      ].map((opt) => (
                        <Button
                          key={opt.value}
                          size="sm"
                          variant={profile?.gender === opt.value ? "default" : "outline"}
                          className="h-7 text-xs px-2"
                          onClick={() => handleGenderChange(opt.value)}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEditingGender(true)}
                    >
                      Change
                    </Button>
                  )}
                </div>

                {profile?.hasAudio && (
                  <AudioPlayer
                    src={`/api/experts/${profile.id}/audio${audioCacheBuster}`}
                    label="Your voice introduction"
                  />
                )}

                {profile?.avatarScript && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleGenerateAudio}
                    disabled={generatingAudio}
                  >
                    {generatingAudio ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating Audio...
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-4 w-4" />
                        {profile.hasAudio ? "Regenerate Voice Intro" : "Generate Voice Intro"}
                      </>
                    )}
                  </Button>
                )}

                {!profile?.avatarScript && (
                  <p className="text-xs text-muted-foreground text-center">
                    Complete your introduction script first
                  </p>
                )}

                <p className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground text-center">
                  MVP uses a system-managed default voice by gender.
                </p>
              </CardContent>
            </Card>

            {/* Session Pricing */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Session Pricing
                  </CardTitle>
                  {!editingPricing ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditingPricing(true)} className="gap-1">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={handleCancelPricing} className="gap-1">
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSavePricing} disabled={savingPricing} className="gap-1">
                        {savingPricing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {renderToast("pricing")}
                {editingPricing ? (
                  <div className="space-y-3">
                    {profile.sessionType !== "OFFLINE" && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">Online rate (SGD/hour)</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={pOnline}
                          onChange={(e) => setPOnline(e.target.value)}
                          placeholder="e.g. 50"
                        />
                      </div>
                    )}
                    {profile.sessionType !== "ONLINE" && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">Offline rate (SGD/hour)</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={pOffline}
                          onChange={(e) => setPOffline(e.target.value)}
                          placeholder="e.g. 80"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profile.sessionType !== "OFFLINE" && (
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <span className="text-sm text-muted-foreground">Online</span>
                        <span className="font-medium">
                          {profile.priceOnlineCents != null && profile.priceOnlineCents > 0
                            ? `SGD ${(profile.priceOnlineCents / 100).toFixed(2)}/hr`
                            : profile.priceOnlineCents === 0 ? "Free" : "Not set"}
                        </span>
                      </div>
                    )}
                    {profile.sessionType !== "ONLINE" && (
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <span className="text-sm text-muted-foreground">Offline</span>
                        <span className="font-medium">
                          {profile.priceOfflineCents != null && profile.priceOfflineCents > 0
                            ? `SGD ${(profile.priceOfflineCents / 100).toFixed(2)}/hr`
                            : profile.priceOfflineCents === 0 ? "Free" : "Not set"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  const isOnlineActive = profile.sessionType !== "OFFLINE";
                  const isOfflineActive = profile.sessionType !== "ONLINE";
                  
                  const isOnlineFree = editingPricing ? parseFloat(pOnline) === 0 : profile.priceOnlineCents === 0;
                  const isOfflineFree = editingPricing ? parseFloat(pOffline) === 0 : profile.priceOfflineCents === 0;
                  const hasFreeSession = (isOnlineActive && isOnlineFree) || (isOfflineActive && isOfflineFree);
                  
                  const isOnlinePaid = editingPricing ? parseFloat(pOnline) > 0 : (profile.priceOnlineCents ?? 0) > 0;
                  const isOfflinePaid = editingPricing ? parseFloat(pOffline) > 0 : (profile.priceOfflineCents ?? 0) > 0;
                  const hasPaidSession = (isOnlineActive && isOnlinePaid) || (isOfflineActive && isOfflinePaid);

                  if (hasFreeSession || !hasPaidSession) return null;
                  
                  return (
                    <p className="text-xs text-muted-foreground">
                      Players pay the full amount when they schedule.
                    </p>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Weekly Availability */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Weekly Availability
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <WeeklyScheduleEditor
                  schedule={(profile?.weeklySchedule as WeeklySchedule) ?? {}}
                  onSave={async (s) => {
                    const res = await fetch("/api/expert/profile", {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}),
                      },
                      body: JSON.stringify({ weeklySchedule: s }),
                    });
                    if (!res.ok) throw new Error("Failed to save");
                    setProfile((prev) => prev ? { ...prev, weeklySchedule: s } : prev);
                    showMessage("Availability saved!", "availability");
                  }}
                  compact
                  showHint
                />
                {renderToast("availability")}
              </CardContent>
            </Card>

            {/* Introduction Script */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Introduction Script</CardTitle>
                  {!editingIntro ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditingIntro(true)} className="gap-1">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={handleCancelIntro} className="gap-1">
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSaveIntro} disabled={savingIntro} className="gap-1">
                        {savingIntro ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {renderToast("intro")}
                {editingIntro ? (
                  <>
                    <Textarea
                      value={introScript}
                      onChange={(e) => setIntroScript(e.target.value)}
                      rows={6}
                      placeholder="Write your introduction..."
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 gap-1.5"
                      onClick={handleImproveIntro}
                      disabled={improvingIntro || !introScript.trim()}
                    >
                      {improvingIntro ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Improve with AI
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[4rem]">
                    {introScript || "No introduction yet. Click Edit to add one."}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Document Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Service Document
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {renderToast("document")}
                {uploadedFileName && (
                  <a
                    href={`/api/experts/${profile.id}/document`}
                    download
                    className="flex items-center gap-2 mb-3 text-sm text-muted-foreground rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <FileDown className="h-4 w-4 shrink-0" />
                    <span className="truncate flex-1">{uploadedFileName}</span>
                    <span className="text-xs shrink-0">Download</span>
                  </a>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      {uploadedFileName ? "Replace PDF" : "Upload PDF"}
                    </>
                  )}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  PDF up to 4MB
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Card className="border-destructive/20 mt-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Once you delete your account, there is no going back. Please be certain.
            </p>
            {renderToast("account")}
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Account"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
