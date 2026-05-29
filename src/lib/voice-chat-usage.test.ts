import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs before vi.mock() factories, so the mocks are available
// at the time the factory executes.
const { upsertMock, findUniqueMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceChatUsage: {
      upsert: upsertMock,
      findUnique: findUniqueMock,
    },
  },
}));

vi.mock("@/lib/voice-chat-config", () => ({
  FREE_REPLY_LIMIT: 3,
}));

import { checkAndIncrementUsage, getUsageForMonth, currentMonth } from "@/lib/voice-chat-usage";

describe("voice-chat-usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("currentMonth()", () => {
    it("returns YYYY-MM format", () => {
      const month = currentMonth();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe("checkAndIncrementUsage()", () => {
    it("allows usage within the free limit", async () => {
      upsertMock.mockResolvedValue({ expertId: "e1", month: "2026-05", replyCount: 2 });

      await expect(checkAndIncrementUsage("e1")).resolves.toBeUndefined();
      expect(upsertMock).toHaveBeenCalledOnce();
    });

    it("allows usage exactly at the limit", async () => {
      upsertMock.mockResolvedValue({ expertId: "e1", month: "2026-05", replyCount: 3 });

      await expect(checkAndIncrementUsage("e1")).resolves.toBeUndefined();
    });

    it("throws when the limit is exceeded (4th reply with limit=3)", async () => {
      upsertMock.mockResolvedValue({ expertId: "e1", month: "2026-05", replyCount: 4 });

      await expect(checkAndIncrementUsage("e1")).rejects.toThrow("Free reply limit exceeded");
    });

    it("creates a new row on first use", async () => {
      upsertMock.mockResolvedValue({ expertId: "e2", month: "2026-05", replyCount: 1 });

      await expect(checkAndIncrementUsage("e2")).resolves.toBeUndefined();
      const call = upsertMock.mock.calls[0][0];
      expect(call.create.replyCount).toBe(1);
      expect(call.update.replyCount).toEqual({ increment: 1 });
    });
  });

  describe("getUsageForMonth()", () => {
    it("returns usage record when found", async () => {
      findUniqueMock.mockResolvedValue({ replyCount: 2 });

      const result = await getUsageForMonth("e1", "2026-05");
      expect(result).toEqual({ replyCount: 2 });
    });

    it("returns null when no usage exists", async () => {
      findUniqueMock.mockResolvedValue(null);

      const result = await getUsageForMonth("e1", "2026-05");
      expect(result).toBeNull();
    });

    it("defaults to the current month", async () => {
      findUniqueMock.mockResolvedValue({ replyCount: 1 });

      await getUsageForMonth("e1");
      const call = findUniqueMock.mock.calls[0][0];
      expect(call.where.expertId_month.month).toBe(currentMonth());
    });
  });
});
