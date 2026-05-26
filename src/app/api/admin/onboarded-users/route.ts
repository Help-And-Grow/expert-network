import { NextRequest, NextResponse } from "next/server";

import { requireAdmin, isErrorResponse } from "@/lib/admin-auth";
import {
  countryFlagEmoji,
  getCountryOption,
  normalizeCountryCodes,
} from "@/lib/expert-countries";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "";
  const val = (cents / 100).toFixed(2);
  return `${currency} ${val}`;
}

/**
 * Render the expert's stored country codes as a flag-prefixed English list,
 * e.g. `🇸🇬 Singapore, 🇲🇾 Malaysia`. Falls back to the bare code when an
 * unknown value sneaks in (kept lenient so a stale row never blows up the
 * admin export). Empty array → empty string.
 */
function formatCountries(raw: unknown): string {
  const codes = normalizeCountryCodes(raw);
  if (codes.length === 0) return "";
  return codes
    .map((code) => {
      const option = getCountryOption(code);
      const flag = countryFlagEmoji(code);
      return option ? `${flag} ${option.name}`.trim() : code;
    })
    .join(", ");
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
  countries: string;
  inviteCode: string;
  onlineFee: string;
  offlineFee: string;
  onboardingStep: string;
  published: string;
};

function markdownEscapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

const HEADER_CELLS = [
  "Profile Name",
  "Email",
  "Telegram Name",
  "Country / Region",
  "Invitation Code",
  "Online Fee",
  "Offline Fee",
  "Onboarding Step",
  "Published",
] as const;

function rowCells(row: Row): string[] {
  return [
    row.profileName,
    row.email,
    row.telegramName,
    row.countries,
    row.inviteCode,
    row.onlineFee,
    row.offlineFee,
    row.onboardingStep,
    row.published,
  ];
}

function toMarkdownTable(rows: Row[]): string {
  const lines: string[] = [];
  lines.push(`| ${HEADER_CELLS.join(" | ")} |`);
  lines.push(`| ${HEADER_CELLS.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(
      `| ${rowCells(row).map(markdownEscapeCell).join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function toHtmlTable(rows: Row[]): string {
  const thead = `<thead><tr>${HEADER_CELLS.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${rowCells(row)
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
  const includeIncompleteRaw =
    request.nextUrl.searchParams.get("includeIncomplete") ??
    request.nextUrl.searchParams.get("include_incomplete") ??
    "1";
  const includeIncomplete = includeIncompleteRaw !== "0";

  const experts = await prisma.expert.findMany({
    where: includeIncomplete ? undefined : { onboardingStep: "PUBLISHED" },
    select: {
      priceOnlineCents: true,
      priceOfflineCents: true,
      currency: true,
      countries: true,
      onboardingStep: true,
      isPublished: true,
      user: {
        select: {
          name: true,
          nickName: true,
          email: true,
          telegramUsername: true,
          inviteCode: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const rows: Row[] = experts.map((expert) => {
    const profileName = expert.user.nickName?.trim() || expert.user.name?.trim() || "";
    const email = expert.user.email?.trim() || "";
    const telegramName = expert.user.telegramUsername?.trim() || "";
    const countries = formatCountries(expert.countries);
    const inviteCode = expert.user.inviteCode?.trim() || "";
    const onlineFee = formatMoney(expert.priceOnlineCents, expert.currency);
    const offlineFee = formatMoney(expert.priceOfflineCents, expert.currency);
    return {
      profileName,
      email,
      telegramName,
      countries,
      inviteCode,
      onlineFee,
      offlineFee,
      onboardingStep: expert.onboardingStep,
      published: expert.isPublished ? "yes" : "",
    };
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
