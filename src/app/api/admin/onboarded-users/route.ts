import { NextRequest, NextResponse } from "next/server";

import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "";
  const val = (cents / 100).toFixed(2);
  return `${currency} ${val}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Row = {
  profileName: string;
  email: string;
  telegramName: string;
  inviteCode: string;
  onlineFee: string;
  offlineFee: string;
};

function markdownEscapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function toMarkdownTable(rows: Row[]): string {
  const header = [
    "Profile Name",
    "Email",
    "Telegram Name",
    "Invitation Code",
    "Online Fee",
    "Offline Fee",
  ];
  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(
      `| ${[
        row.profileName,
        row.email,
        row.telegramName,
        row.inviteCode,
        row.onlineFee,
        row.offlineFee,
      ]
        .map((cell) => markdownEscapeCell(cell))
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function toHtmlTable(rows: Row[]): string {
  const headCells = [
    "Profile Name",
    "Email",
    "Telegram Name",
    "Invitation Code",
    "Online Fee",
    "Offline Fee",
  ];
  const thead = `<thead><tr>${headCells.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${[
          row.profileName,
          row.email,
          row.telegramName,
          row.inviteCode,
          row.onlineFee,
          row.offlineFee,
        ]
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Onboarded Users</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:8px;font-size:14px;vertical-align:top}th{background:#f9fafb;text-align:left}tr:nth-child(even){background:#fcfcfd}</style></head><body><h1>Onboarded Users</h1><table>${thead}${tbody}</table></body></html>`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const format = (request.nextUrl.searchParams.get("format") || "html").toLowerCase();

  const experts = await prisma.expert.findMany({
    where: { onboardingStep: "PUBLISHED" },
    select: {
      priceOnlineCents: true,
      priceOfflineCents: true,
      currency: true,
      user: {
        select: {
          name: true,
          nickName: true,
          email: true,
          telegramUsername: true,
          inviteCode: true,
        },
      },
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const rows: Row[] = experts.map((expert) => {
    const profileName = expert.user.nickName?.trim() || expert.user.name?.trim() || "";
    const email = expert.user.email?.trim() || "";
    const telegramName = expert.user.telegramUsername?.trim() || "";
    const inviteCode = expert.user.inviteCode?.trim() || "";
    const onlineFee = formatMoney(expert.priceOnlineCents, expert.currency);
    const offlineFee = formatMoney(expert.priceOfflineCents, expert.currency);
    return { profileName, email, telegramName, inviteCode, onlineFee, offlineFee };
  });

  if (format === "md" || format === "markdown") {
    return new NextResponse(toMarkdownTable(rows), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(toHtmlTable(rows), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

