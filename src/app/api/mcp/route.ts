import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { absoluteAppUrl } from "@/lib/app-origin";
import { prisma } from "@/lib/prisma";
import { DOMAINS } from "@/lib/constants";

export const maxDuration = 30;

function createServer(originRequest: Request) {
  const server = new McpServer({
    name: "expert-network",
    version: "1.0.0",
  });

  server.tool(
    "list_domains",
    "List all expertise domains available on the platform",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { domains: DOMAINS, count: DOMAINS.length },
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "search_experts",
    "Search for experts by domain, keyword, or session type. Returns a list of matching experts with their profiles, ratings, and pricing.",
    {
      query: z
        .string()
        .optional()
        .describe("Free-text search query (name, bio, services)"),
      domains: z
        .array(z.string())
        .optional()
        .describe(
          "Filter by expertise domains (e.g. ['Fundraising', 'Product Management'])"
        ),
      sessionType: z
        .enum(["ONLINE", "OFFLINE"])
        .optional()
        .describe("Filter by session type"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("Max results (default 10)"),
    },
    async ({ query, domains, sessionType, limit }) => {
      const take = limit || 10;

      const where: Record<string, unknown> = { isPublished: true };

      if (domains && domains.length > 0) {
        where.domains = { some: { domain: { in: domains } } };
      }

      if (sessionType) {
        where.sessionType = { in: [sessionType, "BOTH"] };
      }

      if (query) {
        where.OR = [
          { bio: { contains: query, mode: "insensitive" } },
          {
            user: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { nickName: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        ];
      }

      const experts = await prisma.expert.findMany({
        where,
        include: {
          user: { select: { name: true, nickName: true } },
          domains: { select: { domain: true } },
        },
        orderBy: [{ avgRating: "desc" }, { reviewCount: "desc" }],
        take,
      });

      const results = experts.map((e) => ({
        expertId: e.id,
        name: e.user.nickName || e.user.name || "Expert",
        bio: e.bio?.slice(0, 300) || "",
        domains: e.domains.map((d) => d.domain),
        sessionType: e.sessionType,
        rating: e.avgRating,
        reviewCount: e.reviewCount,
        priceOnline: e.priceOnlineCents
          ? `${e.currency} ${(e.priceOnlineCents / 100).toFixed(2)}/hr`
          : null,
        priceOffline: e.priceOfflineCents
          ? `${e.currency} ${(e.priceOfflineCents / 100).toFixed(2)}/hr`
          : null,
        isVerified: e.isVerified,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { experts: results, total: results.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_expert_profile",
    "Get detailed profile of a specific expert including bio, services, ratings, and availability summary.",
    {
      expertId: z.string().describe("The expert's ID"),
    },
    async ({ expertId }) => {
      const expert = await prisma.expert.findUnique({
        where: { id: expertId, isPublished: true },
        include: {
          user: { select: { name: true, nickName: true, image: true } },
          domains: { select: { domain: true } },
        },
      });

      if (!expert) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Expert not found" }) },
          ],
          isError: true,
        };
      }

      let services: { title: string; description: string }[] = [];
      try {
        if (expert.servicesOffered) {
          services =
            typeof expert.servicesOffered === "string"
              ? JSON.parse(expert.servicesOffered)
              : (expert.servicesOffered as { title: string; description: string }[]);
        }
      } catch {
        /* ignore */
      }

      const profile = {
        expertId: expert.id,
        name: expert.user.nickName || expert.user.name || "Expert",
        image: expert.user.image,
        bio: expert.bio,
        domains: expert.domains.map((d) => d.domain),
        services,
        sessionType: expert.sessionType,
        priceOnline: expert.priceOnlineCents
          ? {
              amount: expert.priceOnlineCents / 100,
              currency: expert.currency,
              perHour: true,
            }
          : null,
        priceOffline: expert.priceOfflineCents
          ? {
              amount: expert.priceOfflineCents / 100,
              currency: expert.currency,
              perHour: true,
            }
          : null,
        rating: expert.avgRating,
        reviewCount: expert.reviewCount,
        isVerified: expert.isVerified,
        profileUrl: absoluteAppUrl(`/experts/${expert.id}`, originRequest),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }],
      };
    }
  );

  server.tool(
    "check_availability",
    "Check an expert's available time slots for a specific date. Returns bookable 30-minute slots.",
    {
      expertId: z.string().describe("The expert's ID"),
      date: z
        .string()
        .describe("Date to check in YYYY-MM-DD format (e.g. '2026-03-25')"),
    },
    async ({ expertId, date }) => {
      const expert = await prisma.expert.findUnique({
        where: { id: expertId, isPublished: true },
        select: { weeklySchedule: true },
      });

      if (!expert) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Expert not found" }) },
          ],
          isError: true,
        };
      }

      const targetDate = new Date(date + "T00:00:00");
      const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const dayKey = dayKeys[targetDate.getDay()];

      const schedule = expert.weeklySchedule as Record<
        string,
        { start: string; end: string }[]
      > | null;
      const ranges = schedule?.[dayKey] || [];

      if (ranges.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                expertId,
                date,
                slots: [],
                message: "No availability on this date",
              }),
            },
          ],
        };
      }

      const bookedSlots = await prisma.booking.findMany({
        where: {
          expertId,
          status: { in: ["CONFIRMED", "PENDING"] },
          startTime: { gte: targetDate },
          endTime: {
            lte: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
          },
        },
        select: { startTime: true, endTime: true },
      });

      const slots: { start: string; end: string; available: boolean }[] = [];
      const now = new Date();

      for (const range of ranges) {
        const [sh, sm] = range.start.split(":").map(Number);
        const [eh, em] = range.end.split(":").map(Number);
        let h = sh,
          m = sm || 0;

        while (h < eh || (h === eh && m < em)) {
          const start = new Date(targetDate);
          start.setHours(h, m, 0, 0);
          const end = new Date(start.getTime() + 30 * 60 * 1000);

          if (start > now) {
            const isBooked = bookedSlots.some(
              (b) => start < b.endTime && end > b.startTime
            );
            slots.push({
              start: start.toISOString(),
              end: end.toISOString(),
              available: !isBooked,
            });
          }

          m += 30;
          if (m >= 60) {
            h += 1;
            m -= 60;
          }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                expertId,
                date,
                slots: slots.filter((s) => s.available),
                totalAvailable: slots.filter((s) => s.available).length,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "match_experts",
    "AI-powered expert matching. Describe what kind of help you need and get personalized expert recommendations with reasons.",
    {
      query: z
        .string()
        .describe(
          "Describe what kind of expert help you need (e.g. 'I need help with fundraising for my Series A')"
        ),
    },
    async ({ query }) => {
      const experts = await prisma.expert.findMany({
        where: { isPublished: true },
        include: {
          user: { select: { name: true, nickName: true } },
          domains: { select: { domain: true } },
        },
        orderBy: [{ avgRating: "desc" }],
        take: 50,
      });

      const summaries = experts
        .map(
          (e) =>
            `ID:${e.id} | ${e.user.nickName || e.user.name} | Domains: ${e.domains.map((d) => d.domain).join(",")} | Rating: ${e.avgRating || "N/A"} | ${e.sessionType} | Bio: ${(e.bio || "").slice(0, 150)}`
        )
        .join("\n");

      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      const scored = experts
        .map((e) => {
          let score = 0;
          const domainText = e.domains.map((d) => d.domain).join(" ").toLowerCase();
          const bioText = (e.bio || "").toLowerCase();
          const matchedDomains: string[] = [];

          for (const word of queryWords) {
            if (domainText.includes(word)) {
              score += 3;
              e.domains.forEach((d) => {
                if (d.domain.toLowerCase().includes(word)) matchedDomains.push(d.domain);
              });
            }
            if (bioText.includes(word)) score += 1;
          }

          if (e.avgRating && e.avgRating > 0) score += e.avgRating;

          return { expert: e, score, matchedDomains: Array.from(new Set(matchedDomains)) };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const recommendations = scored.map((s) => ({
        expertId: s.expert.id,
        name: s.expert.user.nickName || s.expert.user.name || "Expert",
        domains: s.expert.domains.map((d) => d.domain),
        rating: s.expert.avgRating,
        reason:
          s.matchedDomains.length > 0
            ? `Matched domains: ${s.matchedDomains.join(", ")}`
            : `Relevant based on bio/experience`,
        profileUrl: absoluteAppUrl(`/experts/${s.expert.id}`, originRequest),
      }));

      if (recommendations.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query,
                recommendations: [],
                message:
                  "No exact matches found. Here are all available domains: " +
                  DOMAINS.join(", "),
                allExperts: summaries,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { query, recommendations, total: recommendations.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    const server = createServer(req);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp]", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function POST(req: Request) {
  return handleMcpRequest(req);
}

export async function GET(req: Request) {
  return handleMcpRequest(req);
}

export async function DELETE(req: Request) {
  return handleMcpRequest(req);
}
