"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Users,
  CalendarCheck,
  TicketCheck,
  BarChart3,
  Loader2,
  Plus,
  Copy,
  Check,
  Shield,
  Search,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/user-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Stats {
  totalUsers: number;
  totalExperts: number;
  publishedExperts: number;
  totalBookings: number;
  confirmedBookings: number;
  totalRevenueCents: number;
  totalInviteCodes: number;
  usedInviteCodes: number;
}

interface AdminUser {
  id: string;
  name: string | null;
  nickName: string | null;
  email: string | null;
  role: string;
  inviteCode: string | null;
  createdAt: string;
  telegramId: string | null;
  telegramUsername: string | null;
  wechatOpenId: string | null;
  expert: { id: string; isPublished: boolean } | null;
}

interface AdminBooking {
  id: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  status: string;
  paymentStatus: string;
  totalAmountCents: number | null;
  depositAmountCents: number | null;
  currency: string;
  createdAt: string;
  expert: { user: { name: string | null; nickName: string | null; email: string | null } };
  founder: { name: string | null; nickName: string | null; email: string | null };
}

interface InviteCode {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  note: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayName(u: { name: string | null; nickName: string | null; email: string | null }) {
  return u.nickName || u.name || u.email || "—";
}

function statusColor(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "bg-green-100 text-green-700";
    case "PENDING":
    case "PENDING_PAYMENT":
      return "bg-yellow-100 text-yellow-700";
    case "COMPLETED":
      return "bg-blue-100 text-blue-700";
    case "CANCELLED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function roleColor(role: string) {
  switch (role) {
    case "ADMIN":
      return "bg-purple-100 text-purple-700";
    case "EXPERT":
      return "bg-indigo-100 text-indigo-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function platformBadges(user: AdminUser) {
  const badges: string[] = [];
  if (user.email) badges.push("Web");
  if (user.telegramId) badges.push("TG");
  if (user.wechatOpenId) badges.push("WeChat");
  return badges;
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}

function AdminContent() {
  const { status } = useSession();
  const router = useRouter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [newCodeNote, setNewCodeNote] = useState("");
  const [newCodeMaxUses, setNewCodeMaxUses] = useState("10");
  const [newCodeCount, setNewCodeCount] = useState("1");
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin?callbackUrl=/admin");
    }
  }, [status, router]);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, usersRes, bookingsRes, codesRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch(`/api/admin/users${userSearch ? `?search=${encodeURIComponent(userSearch)}` : ""}`),
        fetch("/api/admin/bookings"),
        fetch("/api/admin/invite-codes"),
      ]);

      if (statsRes.status === 403 || usersRes.status === 403) {
        setError("Access denied. You need ADMIN role.");
        setLoading(false);
        return;
      }

      const [statsData, usersData, bookingsData, codesData] = await Promise.all([
        statsRes.json(),
        usersRes.json(),
        bookingsRes.json(),
        codesRes.json(),
      ]);

      setStats(statsData);
      setUsers(usersData.users || []);
      setBookings(Array.isArray(bookingsData) ? bookingsData : []);
      setInviteCodes(Array.isArray(codesData) ? codesData : []);
      setError(null);
    } catch {
      setError("Failed to load admin data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userSearch]);

  useEffect(() => {
    if (status === "authenticated") fetchAll();
  }, [status, fetchAll]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleGenerateCodes = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: parseInt(newCodeCount) || 1,
          maxUses: parseInt(newCodeMaxUses) || 10,
          note: newCodeNote || null,
        }),
      });
      if (res.ok) {
        const newCodes = await res.json();
        setInviteCodes((prev) => [...newCodes, ...prev]);
        setNewCodeNote("");
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
      }
    } catch {
      // ignore
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <Shield className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-lg font-semibold">{error}</h2>
            <Button onClick={() => router.push("/")} variant="outline">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Help &amp; Grow — AI Native Expert Network
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/tidb">TiDB</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="gap-1"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="p-4 space-y-6 pb-12">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="overview" className="gap-1 text-xs sm:text-sm">
              <BarChart3 className="h-4 w-4 hidden sm:block" /> Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1 text-xs sm:text-sm">
              <Users className="h-4 w-4 hidden sm:block" /> Users
            </TabsTrigger>
            <TabsTrigger value="bookings" className="gap-1 text-xs sm:text-sm">
              <CalendarCheck className="h-4 w-4 hidden sm:block" /> Bookings
            </TabsTrigger>
            <TabsTrigger value="invites" className="gap-1 text-xs sm:text-sm">
              <TicketCheck className="h-4 w-4 hidden sm:block" /> Invites
            </TabsTrigger>
          </TabsList>

          {/* ========== OVERVIEW ========== */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {stats && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Total Users" value={stats.totalUsers} icon={<Users className="h-5 w-5 text-indigo-600" />} />
                  <StatCard label="Experts" value={`${stats.publishedExperts} / ${stats.totalExperts}`} subtitle="published / total" icon={<Shield className="h-5 w-5 text-green-600" />} />
                  <StatCard label="Bookings" value={stats.totalBookings} subtitle={`${stats.confirmedBookings} confirmed`} icon={<CalendarCheck className="h-5 w-5 text-blue-600" />} />
                  <StatCard
                    label="Revenue"
                    value={`SGD ${(stats.totalRevenueCents / 100).toFixed(2)}`}
                    subtitle="total paid"
                    icon={<BarChart3 className="h-5 w-5 text-amber-600" />}
                  />
                </div>
                <Card>
                  <CardContent className="pt-4">
                    <h3 className="text-sm font-semibold mb-2">Invitation Codes</h3>
                    <div className="flex gap-4 text-sm">
                      <span>Total: <strong>{stats.totalInviteCodes}</strong></span>
                      <span>Used: <strong>{stats.usedInviteCodes}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ========== USERS ========== */}
          <TabsContent value="users" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-9"
                  onKeyDown={(e) => e.key === "Enter" && fetchAll()}
                />
              </div>
              <Button variant="outline" size="sm" onClick={fetchAll}>
                Search
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{users.length} users</p>
            <div className="space-y-2">
              {users.map((user) => (
                <Card key={user.id}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">
                            {user.nickName || user.name || "No name"}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${roleColor(user.role)}`}>
                            {user.role}
                          </Badge>
                          {platformBadges(user).map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px]">
                              {p}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email || user.telegramUsername || user.id}
                        </p>
                        <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span>Joined {formatDate(user.createdAt)}</span>
                          {user.inviteCode && <span>Code: {user.inviteCode}</span>}
                          {user.expert && (
                            <span className={user.expert.isPublished ? "text-green-600" : "text-yellow-600"}>
                              Expert {user.expert.isPublished ? "(published)" : "(draft)"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e.target.value)}
                          className="text-xs border rounded px-2 py-1 bg-background"
                        >
                          <option value="FOUNDER">FOUNDER</option>
                          <option value="EXPERT">EXPERT</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ========== BOOKINGS ========== */}
          <TabsContent value="bookings" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">{bookings.length} bookings</p>
            {bookings.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No bookings yet
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {bookings.map((b) => (
                  <Card key={b.id}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {displayName(b.founder)} → {displayName(b.expert.user)}
                            </span>
                            <Badge variant="outline" className={`text-[10px] ${statusColor(b.status)}`}>
                              {b.status}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {b.sessionType}
                            </Badge>
                          </div>
                          <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <span>{formatDateTime(b.startTime)} — {formatDateTime(b.endTime)}</span>
                            {b.totalAmountCents != null && b.totalAmountCents > 0 && (
                              <span className="font-medium">
                                {b.currency} {(b.totalAmountCents / 100).toFixed(2)}
                              </span>
                            )}
                            <span>Payment: {b.paymentStatus}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ========== INVITE CODES ========== */}
          <TabsContent value="invites" className="space-y-4 mt-4">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold">Generate New Codes</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Count</label>
                    <Input
                      value={newCodeCount}
                      onChange={(e) => setNewCodeCount(e.target.value)}
                      type="number"
                      min="1"
                      max="50"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max Uses</label>
                    <Input
                      value={newCodeMaxUses}
                      onChange={(e) => setNewCodeMaxUses(e.target.value)}
                      type="number"
                      min="1"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Note</label>
                    <Input
                      value={newCodeNote}
                      onChange={(e) => setNewCodeNote(e.target.value)}
                      placeholder="optional"
                      className="h-9"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleGenerateCodes}
                  disabled={generating}
                  className="gap-1"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Generate
                </Button>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">{inviteCodes.length} codes</p>
            <div className="space-y-2">
              {inviteCodes.map((c) => (
                <Card key={c.id}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="font-mono font-bold text-sm tracking-wider">
                            {c.code}
                          </code>
                          <button
                            onClick={() => handleCopyCode(c.code)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {copiedCode === c.code ? (
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {!c.isActive && (
                            <Badge variant="outline" className="text-[10px] bg-red-100 text-red-700">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span>
                            {c.usedCount} / {c.maxUses} used
                          </span>
                          {c.note && <span>{c.note}</span>}
                          <span>Created {formatDate(c.createdAt)}</span>
                          {c.expiresAt && <span>Expires {formatDate(c.expiresAt)}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="w-16 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-indigo-600 h-1.5 rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, (c.usedCount / c.maxUses) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat Card Component                                                */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  subtitle,
  icon,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted/50">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
